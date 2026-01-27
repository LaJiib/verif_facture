"""FastAPI backend exposing aggregation endpoints."""

from __future__ import annotations

import json
import logging
import os
import hashlib
from pathlib import Path
from time import perf_counter
from typing import Dict, List, Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy.orm import Session

try:
    from telecom_invoice import TelecomInvoiceProcessor
    from telecom_invoice.processor import InvoiceBreakdown
except ImportError:  # pragma: no cover - executed when running module directly
    import sys

    ROOT_DIR = Path(__file__).resolve().parents[1]
    SRC_DIR = ROOT_DIR / "src"
    if str(SRC_DIR) not in sys.path:
        sys.path.insert(0, str(SRC_DIR))
    from telecom_invoice import TelecomInvoiceProcessor
    from telecom_invoice.processor import InvoiceBreakdown

# Ajouter le dossier backend au path pour les imports locaux
import sys
BACKEND_DIR = Path(__file__).resolve().parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

# Import des modules de persistence
from database import get_db
from invoice_saver import save_aggregated_invoices
from models import Entreprise, Ligne, Record
from sqlalchemy import select, func
from datetime import datetime
from storage import StorageError, store_csv_file, list_uploads, delete_upload, delete_uploads_for_entreprise

SAMPLES_DIR = Path("data/csv_examples")

app = FastAPI(title="Factures Télécom API", version="0.1.0")

allowed_origins = [
    os.getenv("FRONTEND_ORIGIN", "http://localhost:5173"),
    os.getenv("FRONTEND_ORIGIN_ALT", "http://127.0.0.1:5173"),
]
allowed_origins = [o for o in allowed_origins if o]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configuration du logging pour tous les modules
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
)

# Récupérer les loggers
logger = logging.getLogger("factures")
db_logger = logging.getLogger("database")
persistence_logger = logging.getLogger("persistence")

# Activer DEBUG pour database et persistence si demandé
if os.getenv("DEBUG_DB", "false").lower() == "true":
    db_logger.setLevel(logging.DEBUG)
    persistence_logger.setLevel(logging.DEBUG)
    logger.info("Mode DEBUG activé pour database et persistence")


class SampleRequest(BaseModel):
    filename: str


class LineFilters(BaseModel):
    date: Optional[str] = None
    date_debut: Optional[str] = None
    date_fin: Optional[str] = None
    numero_compte: Optional[str] = None
    numero_facture: Optional[int] = None
    numero_acces: Optional[str] = None
    type_acces: Optional[List[str]] = None
    type_ligne: Optional[List[str]] = None
    type_charge: Optional[List[str]] = None


class SampleLineRequest(LineFilters):
    filename: str


class SampleAggregateRequest(LineFilters):
    filename: str


def _serialize_facture(facture) -> Dict:
    if isinstance(facture, InvoiceBreakdown):
        facture_dict = facture.to_dict()
    else:
        facture_dict = dict(facture)

    date_value = facture_dict.get("date")
    if hasattr(date_value, "isoformat"):
        facture_dict["date"] = date_value.isoformat()
    else:
        facture_dict["date"] = str(date_value)

    return facture_dict


def _build_response(aggregated: Dict[str, Dict]) -> Dict:
    accounts: List[Dict] = []
    total_ht = 0.0
    facture_count = 0

    for account, payload in aggregated.items():
        factures_serialized = []
        for facture in payload["factures"].values():
            facture_dict = _serialize_facture(facture)
            total_ht += facture_dict.get("total", 0.0)
            facture_count += 1
            factures_serialized.append(facture_dict)

        accounts.append(
            {
                "compte": account,
                "lignes_telecom": payload.get("lignes_telecom", 0),
                "factures": factures_serialized,
            }
        )

    return {
        "accounts": accounts,
        "summary": {
            "total_comptes": len(accounts),
            "total_factures": facture_count,
            "total_ht": round(total_ht, 2),
        },
    }


@app.get("/health")
async def health() -> Dict[str, str]:
    return {"status": "ok"}


@app.get("/samples")
async def list_samples():
    files = []
    if SAMPLES_DIR.exists():
        for path in sorted(SAMPLES_DIR.glob("*.csv")):
            files.append({"name": path.name, "size": path.stat().st_size})
    return {"files": files}


@app.post("/aggregate/upload")
async def aggregate_from_upload(file: UploadFile = File(...), filters: Optional[str] = Form(None)):
    start = perf_counter()
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Fichier vide.")
    logger.info("Upload reçu: %s (%d octets)", file.filename, len(content))
    processor = TelecomInvoiceProcessor()
    processor.load_csv_content(content, silent=True)

    parsed_filters: Dict = {}
    if filters:
        try:
            parsed_filters = json.loads(filters)
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=400, detail="Filtre JSON invalide.") from exc
    filters_clean = _clean_filters(parsed_filters)
    _persist_uploaded_csv(
        content=content,
        original_name=file.filename or "upload.csv",
        category="aggregate_upload",
        extra_metadata={"filters": filters_clean} if filters_clean else None,
    )
    aggregated = (
        processor.aggregate_by_account_filtered(**filters_clean)
        if filters_clean
        else processor.aggregate_by_account()
    )
    elapsed = perf_counter() - start
    logger.info(
        "Agrégation upload terminée en %.2fs (%d comptes, filtres=%s)", elapsed, len(aggregated), filters_clean or "{}"
    )
    return _build_response(aggregated)


@app.post("/aggregate/sample")
async def aggregate_from_sample(request: SampleAggregateRequest):
    target = SAMPLES_DIR / request.filename
    if not target.exists():
        raise HTTPException(status_code=404, detail="Fichier introuvable.")
    filters = _clean_filters(request.dict(exclude={"filename"}))
    logger.info("Lecture sample: %s | filtres=%s", target, filters or "{}")
    processor = TelecomInvoiceProcessor()
    processor.load_csv(target, silent=True)
    start = perf_counter()
    aggregated = (
        processor.aggregate_by_account_filtered(**filters)
        if filters
        else processor.aggregate_by_account()
    )
    elapsed = perf_counter() - start
    logger.info("Agrégation sample terminée en %.2fs (%d comptes)", elapsed, len(aggregated))
    return _build_response(aggregated)


def _filter_lines(processor: TelecomInvoiceProcessor, filters: Dict) -> Dict:
    try:
        rows, summary = processor.filter_lines(**filters)
    except KeyError as exc:
        raise HTTPException(status_code=400, detail=f"Colonne manquante: {exc}") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"rows": rows, "summary": summary}


def _clean_filters(raw: Dict) -> Dict:
    return {k: v for k, v in raw.items() if v is not None and k in TelecomInvoiceProcessor.FILTER_FIELDS}


def _build_facture_signature(aggregated: Dict[str, Dict]) -> Dict[str, Any]:
    """
    Build a logical signature of the CSV content based on factures and dates.
    Avoids extra SQL queries; relies only on the aggregated processor data.
    """
    facture_keys: List[str] = []
    total_detail_lines = 0
    date_values: List[str] = []
    for compte, data in aggregated.items():
        for numero_facture, invoice in data.get("factures", {}).items():
            dt = getattr(invoice, "date", None)
            date_str = dt.isoformat() if hasattr(dt, "isoformat") else str(dt)
            facture_keys.append(f"{numero_facture}|{date_str}|{compte}")
            total_detail_lines += getattr(invoice, "nb_lignes_detail", 0) or 0
            if date_str:
                date_values.append(date_str)

    facture_keys_sorted = sorted(facture_keys)
    signature_text = ";".join(facture_keys_sorted)
    logical_hash = hashlib.sha256(signature_text.encode("utf-8")).hexdigest() if facture_keys_sorted else None
    date_min = min(date_values) if date_values else None
    date_max = max(date_values) if date_values else None

    return {
        "logical_hash": logical_hash,
        "factures_count": len(facture_keys_sorted),
        "facture_keys": facture_keys_sorted,
        "total_detail_lines": total_detail_lines,
        "date_min": date_min,
        "date_max": date_max,
    }
def _persist_uploaded_csv(
    content: bytes,
    original_name: str,
    category: str,
    entreprise: Optional[str] = None,
    extra_metadata: Optional[Dict[str, Any]] = None,
    logical_hash: Optional[str] = None,
):
    """
    Keep a copy of the uploaded CSV without impacting the existing flow.
    Failures are logged but do not stop the request handling.
    """
    try:
        return store_csv_file(
            content=content,
            original_name=original_name or "upload.csv",
            category=category,
            entreprise=entreprise,
            extra_metadata=extra_metadata,
            logical_hash=logical_hash,
        )
    except StorageError as exc:
        logger.warning("CSV non sauvegardé (%s): %s", category, exc)
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("CSV non sauvegardé (%s): %s", category, exc)
    return None


@app.post("/lines/sample")
async def lines_from_sample(request: SampleLineRequest):
    target = SAMPLES_DIR / request.filename
    if not target.exists():
        raise HTTPException(status_code=404, detail="Fichier introuvable.")
    logger.info("Filtres lignes sample: %s | filtres=%s", target, _clean_filters(request.dict(exclude={"filename"})))
    processor = TelecomInvoiceProcessor()
    processor.load_csv(target, silent=True)
    filters = _clean_filters(request.dict(exclude={"filename"}))
    start = perf_counter()
    response = _filter_lines(processor, filters)
    elapsed = perf_counter() - start
    logger.info("Filtrage lignes sample terminé en %.2fs (total=%d)", elapsed, response["summary"]["total_lignes"])
    return response


@app.post("/lines/upload")
async def lines_from_upload(
    file: UploadFile = File(...),
    filters: Optional[str] = Form(None),
):
    start = perf_counter()
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Fichier vide.")
    logger.info("Filtres lignes upload: %s (%d octets)", file.filename, len(content))
    processor = TelecomInvoiceProcessor()
    processor.load_csv_content(content, silent=True)

    parsed_filters: Dict = {}
    if filters:
        try:
            parsed_filters = json.loads(filters)
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=400, detail="Filtre JSON invalide.") from exc
    filters_clean = _clean_filters(parsed_filters)
    _persist_uploaded_csv(
        content=content,
        original_name=file.filename or "upload.csv",
        category="lines_upload",
        extra_metadata={"filters": filters_clean} if filters_clean else None,
    )
    response = _filter_lines(processor, filters_clean)
    elapsed = perf_counter() - start
    logger.info("Filtrage lignes upload terminé en %.2fs (total=%d)", elapsed, response["summary"]["total_lignes"])
    return response


# ==================== ENDPOINTS DE PERSISTENCE ====================


class SaveRequest(BaseModel):
    """Requête pour sauvegarder des données en base."""
    entreprise_name: str = "Par défaut"


@app.post("/save/upload")
async def save_from_upload(
    file: UploadFile = File(...),
    entreprise_name: str = Form("Par défaut"),
    db: Session = Depends(get_db)
):
    """
    Charge un CSV, agrège les données et sauvegarde en base de données.

    Args:
        file: Fichier CSV uploadé
        entreprise_name: Nom de l'entreprise (créée si inexistante)
        db: Session de base de données (injection automatique)

    Returns:
        Statistiques de sauvegarde et résumé
    """
    start = perf_counter()
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Fichier vide.")

    logger.info("Upload pour sauvegarde: %s (%d octets)", file.filename, len(content))

    # Charger et agréger le CSV
    processor = TelecomInvoiceProcessor()
    processor.load_csv_content(content, silent=True)
    aggregated = processor.aggregate_by_account()
    signature = _build_facture_signature(aggregated)
    _persist_uploaded_csv(
        content=content,
        original_name=file.filename or "upload.csv",
        category="save_upload",
        entreprise=entreprise_name,
        extra_metadata={
            "total_comptes": len(aggregated),
            "total_factures": sum(len(v["factures"]) for v in aggregated.values()),
            "signature": signature,
        },
        logical_hash=signature.get("logical_hash"),
    )

    # Sauvegarder en base
    try:
        stats = save_aggregated_invoices(processor, db, entreprise_name)
        elapsed = perf_counter() - start

        logger.info(
            "Sauvegarde terminée en %.2fs: %d lignes créées, %d records créés, %d records ignorés",
            elapsed, stats["lignes_created"], stats["records_created"], stats["records_skipped"]
        )

        return {
            "success": True,
            "stats": stats,
            "elapsed": round(elapsed, 2),
            "entreprise": entreprise_name,
            "summary": {
                "total_comptes": len(aggregated),
                "total_factures": sum(len(v["factures"]) for v in aggregated.values())
            }
        }
    except Exception as e:
        logger.error("Erreur lors de la sauvegarde: %s", str(e))
        raise HTTPException(status_code=500, detail=f"Erreur de sauvegarde: {str(e)}")


@app.post("/save/sample")
async def save_from_sample(
    filename: str = Form(...),
    entreprise_name: str = Form("Par défaut"),
    db: Session = Depends(get_db)
):
    """
    Charge un CSV d'exemple, agrège et sauvegarde en base de données.

    Args:
        filename: Nom du fichier dans data/csv_examples
        entreprise_name: Nom de l'entreprise
        db: Session de base de données

    Returns:
        Statistiques de sauvegarde et résumé
    """
    target = SAMPLES_DIR / filename
    if not target.exists():
        raise HTTPException(status_code=404, detail="Fichier introuvable.")

    logger.info("Sample pour sauvegarde: %s | entreprise=%s", target, entreprise_name)

    start = perf_counter()

    # Charger et agréger
    processor = TelecomInvoiceProcessor()
    processor.load_csv(target, silent=True)
    aggregated = processor.aggregate_by_account()

    # Sauvegarder en base
    try:
        stats = save_aggregated_invoices(processor, db, entreprise_name)
        elapsed = perf_counter() - start

        logger.info(
            "Sauvegarde sample terminée en %.2fs: %d lignes créées, %d records créés, %d records ignorés",
            elapsed, stats["lignes_created"], stats["records_created"], stats["records_skipped"]
        )

        return {
            "success": True,
            "stats": stats,
            "elapsed": round(elapsed, 2),
            "entreprise": entreprise_name,
            "summary": {
                "total_comptes": len(aggregated),
                "total_factures": sum(len(v["factures"]) for v in aggregated.values())
            }
        }
    except Exception as e:
        logger.error("Erreur lors de la sauvegarde: %s", str(e))
        raise HTTPException(status_code=500, detail=f"Erreur de sauvegarde: {str(e)}")

# ============================================================================
# ENDPOINTS POUR LA NAVIGATION ENTREPRISE / LIGNES / RECORDS
# ============================================================================

@app.get("/entreprises")
async def list_entreprises(db: Session = Depends(get_db)):
    """
    Liste toutes les entreprises avec leurs statistiques.

    Returns:
        Liste des entreprises avec nombre de lignes et records
    """
    entreprises = db.execute(select(Entreprise)).scalars().all()

    result = []
    for entreprise in entreprises:
        # Compter les lignes et records
        nb_lignes = db.execute(
            select(func.count(Ligne.id)).where(Ligne.entreprise_id == entreprise.id)
        ).scalar()

        nb_records = db.execute(
            select(func.count(Record.id))
            .join(Ligne)
            .where(Ligne.entreprise_id == entreprise.id)
        ).scalar()

        result.append({
            "id": entreprise.id,
            "nom": entreprise.nom,
            "nb_lignes": nb_lignes,
            "nb_records": nb_records
        })

    return {"entreprises": result}


@app.get("/entreprises/{entreprise_id}/uploads")
async def list_entreprise_uploads(
    entreprise_id: int,
    category: Optional[str] = None,
    limit: int = 100,
    db: Session = Depends(get_db),
):
    """
    Liste les CSV stockés pour une entreprise donnée (tri décroissant).

    Args:
        entreprise_id: ID de l'entreprise
        category: Filtre optionnel (aggregate_upload, lines_upload, save_upload)
        limit: Nombre maximum d'éléments à retourner (défaut 100)
    """
    entreprise = db.execute(
        select(Entreprise).where(Entreprise.id == entreprise_id)
    ).scalar_one_or_none()
    if not entreprise:
        raise HTTPException(status_code=404, detail="Entreprise non trouvée")

    uploads = list_uploads(entreprise=entreprise.nom, category=category, limit=limit)

    def _fmt(meta: Dict[str, Any]) -> Dict[str, Any]:
        uploaded_at = meta.get("uploaded_at")
        month = None
        try:
            if uploaded_at:
                dt = datetime.fromisoformat(uploaded_at.replace("Z", ""))
                month = dt.strftime("%Y-%m")
        except Exception:  # pragma: no cover - defensive
            month = None

        return {
            "upload_id": meta.get("upload_id"),
            "original_name": meta.get("original_name"),
            "category": meta.get("category"),
            "uploaded_at": uploaded_at,
            "uploaded_month": month,
            "size": meta.get("size"),
            "relative_path": meta.get("relative_path"),
            "saved_as": meta.get("saved_as"),
        }

    return {"entreprise": {"id": entreprise.id, "nom": entreprise.nom}, "uploads": [_fmt(u) for u in uploads]}


@app.delete("/uploads/{upload_id}")
async def remove_upload(upload_id: str):
    """Supprime un CSV stocké (fichier + métadonnée)."""
    if not delete_upload(upload_id):
        raise HTTPException(status_code=404, detail="Upload non trouvé")
    return {"message": "Upload supprimé", "upload_id": upload_id}


@app.post("/entreprises")
async def create_entreprise(nom: str = Form(...), db: Session = Depends(get_db)):
    """
    Crée une nouvelle entreprise.

    Args:
        nom: Nom de l'entreprise

    Returns:
        L'entreprise créée
    """
    # Vérifier si l'entreprise existe déjà
    existing = db.execute(
        select(Entreprise).where(Entreprise.nom == nom)
    ).scalar_one_or_none()

    if existing:
        raise HTTPException(status_code=400, detail=f"L'entreprise '{nom}' existe déjà")

    entreprise = Entreprise(nom=nom)
    db.add(entreprise)
    db.commit()
    db.refresh(entreprise)

    logger.info(f"Nouvelle entreprise créée: {nom} (id={entreprise.id})")

    return {
        "id": entreprise.id,
        "nom": entreprise.nom,
        "nb_lignes": 0,
        "nb_records": 0
    }


@app.delete("/entreprises/{entreprise_id}")
async def delete_entreprise_endpoint(entreprise_id: int, db: Session = Depends(get_db)):
    """
    Supprime une entreprise (avec cascade DB) et les CSV associés.
    """
    entreprise = db.execute(
        select(Entreprise).where(Entreprise.id == entreprise_id)
    ).scalar_one_or_none()

    if not entreprise:
        raise HTTPException(status_code=404, detail="Entreprise non trouvée")

    uploads_deleted = delete_uploads_for_entreprise(entreprise.nom)

    db.delete(entreprise)
    db.commit()

    logger.info("Entreprise supprimée: %s (uploads supprimés: %d)", entreprise.nom, uploads_deleted)

    return {"message": "Entreprise supprimée", "uploads_deleted": uploads_deleted}


@app.get("/entreprises/{entreprise_id}/aggregation")
async def get_entreprise_aggregation(entreprise_id: int, db: Session = Depends(get_db)):
    """
    Récupère les données agrégées d'une entreprise par mois et type de ligne.

    Returns:
        {
          "entreprise": {...},
          "aggregation_par_mois": {
            "2025-11": {
              "total_ht": 12345.67,
              "par_type_ligne": {
                "Internet": {"count": 5, "total_ht": 5000.00},
                "Fixe": {"count": 10, "total_ht": 3000.00},
                ...
              }
            }
          }
        }
    """
    # Vérifier que l'entreprise existe
    entreprise = db.execute(
        select(Entreprise).where(Entreprise.id == entreprise_id)
    ).scalar_one_or_none()

    if not entreprise:
        raise HTTPException(status_code=404, detail="Entreprise non trouvée")

    # Récupérer tous les records de l'entreprise
    records = db.execute(
        select(Record, Ligne)
        .join(Ligne, Record.ligne_id == Ligne.id)
        .where(Ligne.entreprise_id == entreprise_id)
        .order_by(Record.date.desc())
    ).all()

    # Agréger par mois et type de ligne
    aggregation_par_mois = {}

    for record, ligne in records:
        # Format mois: YYYY-MM
        mois_key = record.date.strftime("%Y-%m") if record.date else "Inconnu"

        if mois_key not in aggregation_par_mois:
            aggregation_par_mois[mois_key] = {
                "mois": record.mois,
                "total_ht": 0.0,
                "total_ttc": 0.0,
                "par_type_ligne": {}
            }

        # Agréger par type de ligne
        type_ligne = ligne.type_ligne
        if type_ligne not in aggregation_par_mois[mois_key]["par_type_ligne"]:
            aggregation_par_mois[mois_key]["par_type_ligne"][type_ligne] = {
                "count": 0,
                "total_ht": 0.0,
                "total_ttc": 0.0,
                "lignes": []
            }

        aggregation_par_mois[mois_key]["total_ht"] += record.total_ht
        aggregation_par_mois[mois_key]["total_ttc"] += record.total_ttc
        aggregation_par_mois[mois_key]["par_type_ligne"][type_ligne]["count"] += 1
        aggregation_par_mois[mois_key]["par_type_ligne"][type_ligne]["total_ht"] += record.total_ht
        aggregation_par_mois[mois_key]["par_type_ligne"][type_ligne]["total_ttc"] += record.total_ttc

        # Ajouter les infos de ligne (pour drill-down ultérieur)
        aggregation_par_mois[mois_key]["par_type_ligne"][type_ligne]["lignes"].append({
            "ligne_id": ligne.id,
            "numero_acces": ligne.numero_acces,
            "nom": ligne.nom,
            "record_id": record.id,
            "numero_facture": record.numero_facture,
            "total_ht": record.total_ht
        })

    return {
        "entreprise": {
            "id": entreprise.id,
            "nom": entreprise.nom
        },
        "aggregation_par_mois": aggregation_par_mois
    }


@app.get("/lignes/{ligne_id}/records")
async def get_ligne_records(ligne_id: int, db: Session = Depends(get_db)):
    """
    Récupère tous les records d'une ligne spécifique.

    Returns:
        Liste des records avec détails de facturation
    """
    # Vérifier que la ligne existe
    ligne = db.execute(
        select(Ligne).where(Ligne.id == ligne_id)
    ).scalar_one_or_none()

    if not ligne:
        raise HTTPException(status_code=404, detail="Ligne non trouvée")

    # Récupérer tous les records de la ligne
    records = db.execute(
        select(Record)
        .where(Record.ligne_id == ligne_id)
        .order_by(Record.date.desc())
    ).scalars().all()

    records_list = []
    for record in records:
        records_list.append({
            "id": record.id,
            "numero_compte": record.numero_compte,
            "numero_facture": record.numero_facture,
            "date": record.date.isoformat() if record.date else None,
            "mois": record.mois,
            "abo": record.abo,
            "conso": record.conso,
            "remise": record.remise,
            "total_ht": record.total_ht,
            "total_ttc": record.total_ttc,
            "nb_lignes_detail": record.nb_lignes_detail,
            "statut": record.statut
        })

    return {
        "ligne": {
            "id": ligne.id,
            "nom": ligne.nom,
            "numero_acces": ligne.numero_acces,
            "type_ligne": ligne.type_ligne,
            "adresse": ligne.adresse
        },
        "records": records_list
    }
