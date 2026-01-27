"""Use-case endpoints orchestrating multiple commands."""

from __future__ import annotations

import logging
import json
from pathlib import Path
from logging.handlers import RotatingFileHandler

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.orm import Session
from sqlalchemy import func

from ..database import get_db
from ..models import Facture, LigneFacture, Ligne, Entreprise
from ..storage import store_csv_file, load_upload_bytes, get_upload, StorageError
from .schemas import AutoVerifResult, AutoVerifFullResult
from .autoverif import compute_auto_verif_full
from .import_csv import parse_csv_file, run_import, extract_rows_data, normalize_format_cfg

router = APIRouter(prefix="/v2/usecase", tags=["usecase"])
logger = logging.getLogger("api_v2.usecase")


STATUT_IMPORTE = 0


@router.post("/autoverif/ecart", response_model=AutoVerifResult)
def auto_verify_ecart(facture_id: int, db: Session = Depends(get_db)):
    facture = db.query(Facture).filter(Facture.id == facture_id).first()
    if not facture:
        raise HTTPException(status_code=404, detail="Facture introuvable")
    # Simple écart: somme des lignes vs facture
    sums = (
        db.query(
            func.sum(LigneFacture.abo + LigneFacture.conso + LigneFacture.remises + LigneFacture.achat).label(
                "total_lignes"
            )
        )
        .filter(LigneFacture.facture_id == facture_id)
        .first()
    )
    total_lignes = float(sums.total_lignes or 0)
    total_facture = facture.total_ht
    ecart = round(total_facture - total_lignes, 2)
    statut = "valide" if abs(ecart) < 0.01 else "conteste"
    commentaire = "OK" if statut == "valide" else f"Écart détecté ({ecart:+.2f} €)"

    # Lignes manquantes
    lignes_count = (
        db.query(func.count(Ligne.id))
        .join(LigneFacture, Ligne.id == LigneFacture.ligne_id)
        .filter(LigneFacture.facture_id == facture_id)
        .scalar()
        or 0
    )
    rows_missing = 0 if lignes_count > 0 else 1

    result = AutoVerifResult(
        statut=statut,
        ecart=ecart,
        commentaire=commentaire,
        rows_missing_count=rows_missing,
        details={"total_facture": total_facture, "total_lignes": total_lignes},
    )
    logger.info("Auto-verif facture_id=%s statut=%s ecart=%.2f", facture_id, statut, ecart)
    return result


@router.post("/autoverif/full", response_model=AutoVerifFullResult)
def auto_verify_full(facture_id: int, db: Session = Depends(get_db)):
    """Auto-vérification complète orchestrée côté backend (plus d'accès SQL brut côté frontend)."""
    return compute_auto_verif_full(facture_id, db)


@router.post("/import-csv")
async def import_csv_usecase(
    entreprise_id: int = Form(...),
    file: UploadFile = File(...),
    format: str | None = Form(None),
    confirmed_accounts: str | None = Form(None),
    confirmed_abos: str | None = Form(None),
    analyze_abos: str | None = Form(None),
    dry_run: bool = Form(False),
    db: Session = Depends(get_db),
):
    """
    Endpoint unique d'import CSV.
    - Analyse le CSV avec le format fourni (sinon format par defaut cote front).
    - Si des comptes sont manquants et non confirmes, retourne status requires_account_confirmation.
    - Si dry_run, ne cree rien et retourne les comptes a creer.
    """
    entreprise = db.query(Entreprise).filter(Entreprise.id == entreprise_id).first()
    if not entreprise:
        raise HTTPException(status_code=404, detail="Entreprise introuvable")

    try:
        content = await file.read()
        rows = parse_csv_file(content)
    except Exception as exc:  # pragma: no cover - defensive
        raise HTTPException(status_code=400, detail=f"CSV invalide: {exc}") from exc

    try:
        format_cfg_raw = json.loads(format) if format else None
    except Exception as exc:  # pragma: no cover - defensive
        raise HTTPException(status_code=400, detail=f"Format invalide: {exc}") from exc
    format_cfg = normalize_format_cfg(format_cfg_raw)

    confirmed_map = None
    if confirmed_accounts:
        try:
            confirmed_map = {c["num"]: c for c in json.loads(confirmed_accounts) or []}
        except Exception as exc:  # pragma: no cover - defensive
            raise HTTPException(status_code=400, detail=f"confirmed_accounts invalide: {exc}") from exc

    confirmed_abos_list = None
    if confirmed_abos:
        try:
            confirmed_abos_list = json.loads(confirmed_abos) or []
        except Exception as exc:  # pragma: no cover - defensive
            raise HTTPException(status_code=400, detail=f"confirmed_abos invalide: {exc}") from exc

    analyze_abos_cfg = None
    if analyze_abos:
        try:
            analyze_abos_cfg = json.loads(analyze_abos) or None
        except Exception as exc:  # pragma: no cover - defensive
            raise HTTPException(status_code=400, detail=f"analyze_abos invalide: {exc}") from exc

    rows_data = extract_rows_data(rows, format_cfg)
    date_values = [l["date"] for l in rows_data if l.get("date")]
    date_min = min(date_values) if date_values else None
    date_max = max(date_values) if date_values else None

    upload_id = None
    try:
        stored = store_csv_file(
            content=content,
            original_name=file.filename or "import.csv",
            category="import_csv",
            entreprise=entreprise.nom,
            extra_metadata={
                "entreprise_id": entreprise_id,
                "format": format_cfg,
                "date_min": date_min,
                "date_max": date_max,
                "lignes_csv": len(rows),
            },
        )
        upload_id = stored.upload_id
    except StorageError as exc:  # pragma: no cover - defensive
        logger.warning("Stockage CSV impossible: %s", exc)

    result = run_import(
        db=db,
        entreprise_id=entreprise_id,
        rows=rows,
        format_cfg=format_cfg,
        confirmed_accounts=confirmed_map,
        confirmed_abos=confirmed_abos_list,
        analyze_abos=analyze_abos_cfg,
        dry_run=dry_run,
        upload_id=upload_id,
        rows_data=rows_data,
    )
    return result


@router.post("/import-csv/confirm-accounts")
async def confirm_import_accounts(
    entreprise_id: int = Form(...),
    upload_id: str = Form(...),
    confirmed_accounts: str = Form(...),
    format: str | None = Form(None),
    db: Session = Depends(get_db),
):
    entreprise = db.query(Entreprise).filter(Entreprise.id == entreprise_id).first()
    if not entreprise:
        raise HTTPException(status_code=404, detail="Entreprise introuvable")

    meta = get_upload(upload_id)
    if not meta:
        raise HTTPException(status_code=404, detail="upload_id inconnu")
    extra = meta.get("extra") or {}
    meta_ent_id = extra.get("entreprise_id")
    if meta_ent_id and int(meta_ent_id) != int(entreprise_id):
        raise HTTPException(status_code=400, detail="upload_id n'appartient pas a cette entreprise")

    try:
        content = load_upload_bytes(upload_id)
        rows = parse_csv_file(content)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover - defensive
        raise HTTPException(status_code=400, detail=f"Lecture CSV impossible: {exc}") from exc

    try:
        format_cfg_raw = json.loads(format) if format else (extra.get("format") or None)
    except Exception as exc:  # pragma: no cover - defensive
        raise HTTPException(status_code=400, detail=f"Format invalide: {exc}") from exc
    format_cfg = normalize_format_cfg(format_cfg_raw)

    try:
        confirmed_map = {c["num"]: c for c in json.loads(confirmed_accounts) or []}
    except Exception as exc:  # pragma: no cover - defensive
        raise HTTPException(status_code=400, detail=f"confirmed_accounts invalide: {exc}") from exc

    rows_data = extract_rows_data(rows, format_cfg)

    result = run_import(
        db=db,
        entreprise_id=entreprise_id,
        rows=rows,
        format_cfg=format_cfg,
        confirmed_accounts=confirmed_map,
        dry_run=False,
        upload_id=upload_id,
        rows_data=rows_data,
    )
    return result


@router.post("/llm/summarize")
def summarize_llm(payload: dict):
    texts = payload.get("texts") or []
    if not isinstance(texts, list) or not texts:
        raise HTTPException(status_code=400, detail="texts requis")
    system = payload.get("system") or ""
    joined = " ".join(str(t) for t in texts)
    summary = joined[:500]
    logger.info("LLM summarize count=%s", len(texts))
    return {"summary": summary, "system": system}
