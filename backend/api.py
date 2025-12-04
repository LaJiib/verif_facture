"""
API REST restructurée pour la gestion des factures télécom.

Endpoints organisés par ressource:
- /entreprises: Gestion des entreprises
- /comptes: Gestion des comptes de facturation
- /lignes: Gestion des lignes télécom
- /factures: Gestion des factures
- /lignes-factures: Gestion des détails ligne/facture
- /query: Requêtes SQL personnalisées (lecture seule)
"""

from typing import List, Optional, Dict, Any
from datetime import date, datetime
from pathlib import Path
import logging
import csv
import io
import unicodedata
from fastapi import FastAPI, HTTPException, Depends, UploadFile, File, Form, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, HTMLResponse
from pydantic import BaseModel
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, sessionmaker
import requests

from .config import DATABASE_URL
from .models import Base, Entreprise, Compte, Ligne, Facture, LigneFacture, FactureReport
from .storage import list_uploads, delete_upload, delete_uploads_for_entreprise, store_csv_file, StorageError, load_upload_bytes, get_upload

# Configuration du logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Configuration de la base de données
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Create all tables on startup
Base.metadata.create_all(bind=engine)

app = FastAPI(title="Vérification Factures Télécom")

# Dossier frontend (copie de frontend/dist)
STATIC_DIR = Path(__file__).parent / "static"
ASSETS_DIR = STATIC_DIR / "assets"
if ASSETS_DIR.exists():
    app.mount("/assets", StaticFiles(directory=ASSETS_DIR), name="assets")

# Favicon
@app.get("/logo.ico")
def favicon():
    favicon_path = STATIC_DIR / "logo.ico"
    if favicon_path.exists():
        return FileResponse(favicon_path)
    raise HTTPException(status_code=404, detail="favicon not found")

# Page d'accueil: sert le frontend compilé s'il est présent
@app.get("/", response_class=HTMLResponse)
def serve_frontend():
    index_path = STATIC_DIR / "index.html"
    if index_path.exists():
        return FileResponse(index_path)
    return HTMLResponse(
        "<h1>Frontend non disponible</h1><p>Compilez le frontend puis copiez frontend/dist vers backend/static.</p>",
        status_code=503,
    )

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Dépendance pour obtenir une session DB
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ============================================================================
# SCHEMAS PYDANTIC - ENTREPRISES
# ============================================================================

class EntrepriseCreate(BaseModel):
    nom: str


class EntrepriseResponse(BaseModel):
    id: int
    nom: str

    class Config:
        from_attributes = True


# ============================================================================
# SCHEMAS PYDANTIC - COMPTES
# ============================================================================

class CompteCreate(BaseModel):
    num: str
    nom: Optional[str] = None
    entreprise_id: int
    lot: Optional[str] = None


class CompteUpdate(BaseModel):
    nom: Optional[str] = None
    lot: Optional[str] = None


class CompteResponse(BaseModel):
    id: int
    num: str
    nom: Optional[str]
    entreprise_id: int
    lot: Optional[str]

    class Config:
        from_attributes = True


# ============================================================================
# SCHEMAS PYDANTIC - LIGNES
# ============================================================================

class LigneCreate(BaseModel):
    num: str
    type: int = 0
    compte_id: int


class LigneUpdate(BaseModel):
    type: Optional[int] = None


class LigneResponse(BaseModel):
    id: int
    num: str
    type: int
    compte_id: int

    class Config:
        from_attributes = True


# ============================================================================
# SCHEMAS PYDANTIC - FACTURES
# ============================================================================

class FactureCreate(BaseModel):
    fournisseur: str = "Orange"
    num: str
    compte_id: int
    date: date
    abo: float = 0
    conso: float = 0
    remises: float = 0
    achat: float = 0
    statut: int = 0  # 0=importe,1=valide,2=conteste
    csv_id: Optional[str] = None  # identifiant d'upload CSV


class FactureUpdate(BaseModel):
    abo: Optional[float] = None
    conso: Optional[float] = None
    remises: Optional[float] = None
    achat: Optional[float] = None
    statut: Optional[int] = None
    csv_id: Optional[str] = None


class FactureResponse(BaseModel):
    id: int
    fournisseur: str
    num: str
    compte_id: int
    date: date
    abo: float
    conso: float
    remises: float
    achat: float
    statut: int
    total_ht: float
    csv_id: Optional[str] = None

    class Config:
        from_attributes = True


# ============================================================================
# SCHEMAS PYDANTIC - LIGNES-FACTURES
# ============================================================================

class LigneFactureCreate(BaseModel):
    facture_id: int
    ligne_id: int
    abo: float = 0
    conso: float = 0
    remises: float = 0
    achat: float = 0


class LigneFactureUpdate(BaseModel):
    abo: Optional[float] = None
    conso: Optional[float] = None
    remises: Optional[float] = None
    achat: Optional[float] = None


class LigneFactureResponse(BaseModel):
    id: int
    facture_id: int
    ligne_id: int
    abo: float
    conso: float
    remises: float
    achat: float
    total_ht: float

    class Config:
        from_attributes = True

# ============================================================================
# SCHEMAS PYDANTIC - RAPPORT FACTURE
# ============================================================================

class FactureReportPayload(BaseModel):
    commentaire: Optional[str] = None
    data: Optional[dict] = None


class FactureReportResponse(BaseModel):
    facture_id: int
    commentaire: Optional[str]
    data: Optional[dict]
    updated_at: datetime

    class Config:
        from_attributes = True
        json_encoders = {datetime: lambda v: v.isoformat()}


# ============================================================================
# ENDPOINTS - ENTREPRISES
# ============================================================================

@app.get("/entreprises", response_model=List[EntrepriseResponse])
def list_entreprises(db: Session = Depends(get_db)):
    """Liste toutes les entreprises."""
    return db.query(Entreprise).all()


@app.post("/entreprises", response_model=EntrepriseResponse)
def create_entreprise(entreprise: EntrepriseCreate, db: Session = Depends(get_db)):
    """Crée une nouvelle entreprise."""
    logger.info(f"Création entreprise: {entreprise.nom}")
    db_entreprise = Entreprise(nom=entreprise.nom)
    db.add(db_entreprise)
    try:
        db.commit()
        db.refresh(db_entreprise)
        logger.info(f"Entreprise créée: id={db_entreprise.id}")
        return db_entreprise
    except Exception as e:
        db.rollback()
        logger.error(f"Erreur création entreprise: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/entreprises/{entreprise_id}", response_model=EntrepriseResponse)
def get_entreprise(entreprise_id: int, db: Session = Depends(get_db)):
    """Récupère une entreprise par ID."""
    entreprise = db.query(Entreprise).filter(Entreprise.id == entreprise_id).first()
    if not entreprise:
        raise HTTPException(status_code=404, detail="Entreprise non trouvée")
    return entreprise


@app.put("/entreprises/{entreprise_id}", response_model=EntrepriseResponse)
def update_entreprise(
    entreprise_id: int, entreprise: EntrepriseCreate, db: Session = Depends(get_db)
):
    """Met à jour le nom d'une entreprise."""
    db_entreprise = db.query(Entreprise).filter(Entreprise.id == entreprise_id).first()
    if not db_entreprise:
        raise HTTPException(status_code=404, detail="Entreprise non trouvée")

    db_entreprise.nom = entreprise.nom
    try:
        db.commit()
        db.refresh(db_entreprise)
        return db_entreprise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))


@app.delete("/entreprises/{entreprise_id}")
def delete_entreprise(entreprise_id: int, db: Session = Depends(get_db)):
    """Supprime une entreprise et toutes ses données."""
    db_entreprise = db.query(Entreprise).filter(Entreprise.id == entreprise_id).first()
    if not db_entreprise:
        raise HTTPException(status_code=404, detail="Entreprise non trouvée")

    uploads_deleted = delete_uploads_for_entreprise(db_entreprise.nom)

    db.delete(db_entreprise)
    db.commit()
    return {"message": "Entreprise supprimée", "uploads_deleted": uploads_deleted}


@app.get("/entreprises/{entreprise_id}/uploads")
def list_entreprise_uploads(
    entreprise_id: int,
    category: Optional[str] = None,
    limit: int = 100,
    db: Session = Depends(get_db),
):
    """Liste les CSV stockés pour une entreprise."""
    entreprise = db.query(Entreprise).filter(Entreprise.id == entreprise_id).first()
    if not entreprise:
        raise HTTPException(status_code=404, detail="Entreprise non trouvée")

    # Supporte les anciens uploads taggés par nom ou par id (entreprise_<id>)
    names_to_check = [entreprise.nom, f"entreprise_{entreprise.id}"]
    uploads_raw: List[Dict[str, Any]] = []
    seen_ids = set()
    for name in names_to_check:
        for meta in list_uploads(entreprise=name, category=category, limit=limit):
            uid = meta.get("upload_id")
            if uid in seen_ids:
                continue
            uploads_raw.append(meta)
            seen_ids.add(uid)
            if limit and len(uploads_raw) >= limit:
                break
        if limit and len(uploads_raw) >= limit:
            break

    def _extract_month(meta: Dict[str, Any]) -> Optional[str]:
        extra = meta.get("extra") or {}
        # Priorité: date_min/date_max des métadonnées > signature.date_min > uploaded_at
        date_candidate = (
            extra.get("date_min")
            or extra.get("date_max")
            or (extra.get("signature") or {}).get("date_min")
            or meta.get("uploaded_at")
        )
        if not date_candidate:
            return None
        try:
            dt = datetime.fromisoformat(str(date_candidate).replace("Z", ""))
            return dt.strftime("%Y-%m")
        except Exception:
            return None

    formatted = []
    for meta in uploads_raw:
        formatted.append({
            "upload_id": meta.get("upload_id"),
            "original_name": meta.get("original_name"),
            "category": meta.get("category"),
            "uploaded_at": meta.get("uploaded_at"),
            "uploaded_month": _extract_month(meta),
            "size": meta.get("size"),
            "relative_path": meta.get("relative_path"),
            "saved_as": meta.get("saved_as"),
            "extra": meta.get("extra"),
        })

    return {"entreprise": {"id": entreprise.id, "nom": entreprise.nom}, "uploads": formatted}


@app.delete("/uploads/{upload_id}")
def remove_upload(upload_id: str):
    """Supprime un CSV stocké (fichier + métadonnée)."""
    if not delete_upload(upload_id):
        raise HTTPException(status_code=404, detail="Upload non trouvé")
    return {"message": "Upload supprimé", "upload_id": upload_id}


@app.get("/uploads/{upload_id}/download")
def download_upload(upload_id: str):
    """Télécharge le CSV stocké."""
    try:
        content = load_upload_bytes(upload_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Upload non trouvé")
    meta = get_upload(upload_id) or {}
    filename = meta.get("original_name") or f"{upload_id}.csv"
    return Response(
        content,
        media_type="text/csv",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Expose-Headers": "Content-Disposition",
        },
    )


# ============================================================================ 
# AUTO VERIFICATION FACTURE (LLM + CSV) 
# ============================================================================


def _call_llm_summary(texts: List[str], system: Optional[str] = None) -> str:
    """Appel texte (legacy)."""
    system_prompt = system or "Tu es un assistant qui résume brièvement l'origine d'un écart de facturation."
    user_content = "\n".join(texts)
    try:
        logger.info(
            "[LLM] payload complet (auto-verif) | system=%s | count=%d | payload=%s",
            system_prompt,
            len(texts),
            texts,
        )
        resp = requests.post(
            "http://localhost:11434/api/chat",
            json={
                "model": "qwen2.5:0.5b",
                "stream": False,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_content},
                ],
                "options": {"temperature": 0.3, "num_ctx": 2048},
            },
            timeout=45,
        )
        resp.raise_for_status()
        data = resp.json()
        return ((data.get("message") or {}).get("content") or "").strip()
    except Exception as exc:  # pragma: no cover - defensive
        logger.error("LLM summary error: %s", exc)
        return ""


def _call_llm_structured(prompt: str, system: str) -> dict:
    """Appel structur?: force une sortie JSON avec les cl?s attendues."""
    logger.info("[LLM] prompt complet (structured) | system=%s | prompt=%s", system, prompt)
    try:
        resp = requests.post(
            "http://localhost:11434/api/chat",
            json={
                "model": "qwen2.5:0.5b",
                "stream": False,
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": prompt},
                ],
                "options": {"temperature": 0.2, "num_ctx": 2048},
            },
            timeout=45,
        )
        resp.raise_for_status()
        data = resp.json()
        content = ((data.get("message") or {}).get("content") or "").strip()
        if content.startswith("```"):
            content = content.strip("`").strip()
            if content.lower().startswith("json"):
                content = content[4:].strip()
        try:
            parsed = json.loads(content)
            if isinstance(parsed, dict) and len(parsed) == 1 and isinstance(next(iter(parsed.values())), dict):
                parsed = next(iter(parsed.values()))
        except Exception:
            logger.error("[LLM] JSON parse failed, content=%s", content)
            raise HTTPException(status_code=500, detail="LLM n'a pas renvoyé un JSON valide")
        required = ["origine_ecart", "commentaire", "recommandation"]
        for key in required:
            if key not in parsed:
                raise HTTPException(status_code=500, detail=f"LLM: champ manquant {key}")
        rec = str(parsed.get("recommandation", "")).strip().upper()
        if rec not in {"VALIDATION", "CONTESTATION", "SURVEILLANCE"}:
            rec = "SURVEILLANCE"
        parsed["recommandation"] = rec
        return parsed
    except requests.RequestException as exc:
        logger.error("[LLM] Ollama non joignable: %s", exc)
        raise HTTPException(status_code=500, detail=f"Ollama non joignable: {exc}")

def _parse_csv_rows_for_facture(upload_id: str, facture_num: str) -> Dict[str, Any]:
    content = load_upload_bytes(upload_id)
    # Détecte automatiquement le séparateur (',' ou ';') et gère le BOM.
    decoded = content.decode("utf-8", errors="ignore")
    sample = decoded[:10000]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=[",", ";", "\t"])
        delimiter = dialect.delimiter
    except Exception:
        delimiter = ";" if ";" in sample else ","

    text_io = io.StringIO(decoded)
    reader = csv.DictReader(text_io, delimiter=delimiter)
    rows = list(reader)

    def norm(s: str) -> str:
        # Normalise accents et espaces pour matcher les en-têtes
        return (
            unicodedata.normalize("NFKD", s or "")
            .encode("ascii", "ignore")
            .decode("ascii")
            .lower()
            .strip()
        )

    headers = [(h or "").lstrip("\ufeff") for h in (reader.fieldnames or [])]
    header_norm = {h: norm(h) for h in headers}
    facture_col = next((h for h, n in header_norm.items() if "facture" in n), None)
    access_col = next(
        (
            h
            for h, n in header_norm.items()
            if "numero acces" in n or "num acces" in n or n.startswith("acces") or "access" in n or ("acc" in n and "facture" not in n)
        ),
        None,
    )
    libelle_col = next((h for h, n in header_norm.items() if "libelle" in n), None)
    rubrique_col = next((h for h, n in header_norm.items() if "rubrique" in n), None)
    montant_col = next((h for h, n in header_norm.items() if "montant" in n and "ht" in n), None)

    filtered_rows = rows
    if facture_col:
        target = str(facture_num).strip()
        filtered_rows = [r for r in rows if str(r.get(facture_col, "")).strip() == target]

    if access_col:
        missing_access = [r for r in filtered_rows if not str(r.get(access_col, "") or "").strip()]
    else:
        missing_access = []

    rows_by_access: Dict[str, List[Dict[str, Any]]] = {}
    if access_col:
        for r in filtered_rows:
            key = str(r.get(access_col, "") or "").strip()
            rows_by_access.setdefault(key, []).append(r)

    logger.info(
        "[AUTO][CSV] filtre facture=%s | col_facture=%s | col_acces=%s | rows_total=%d | rows_facture=%d | rows_missing_acces=%d",
        facture_num,
        facture_col,
        access_col,
        len(rows),
        len(filtered_rows),
        len(missing_access),
    )
    if missing_access:
        logger.info("[AUTO][CSV] sample missing rows (2 max)=%s", missing_access[:2])

    return {
        "rows": filtered_rows,
        "missing_access": missing_access,
        "facture_col": facture_col,
        "access_col": access_col,
        "libelle_col": libelle_col,
        "rubrique_col": rubrique_col,
        "montant_ht_col": montant_col,
        "rows_by_access": rows_by_access,
    }


@app.post("/factures/{facture_id}/autoverif")
def auto_verif_facture(facture_id: int, db: Session = Depends(get_db)):
    """
    Exécute l'auto-vérification côté backend :
    - calcule l'écart facture vs lignes
    - si écart non nul, analyse les lignes du CSV (facture) sans numéro d'accès
    - envoie ces lignes au LLM pour un commentaire court
    """
    facture = db.query(Facture).filter(Facture.id == facture_id).first()
    if not facture:
        raise HTTPException(status_code=404, detail="Facture non trouvée")

    # Total lignes
    lignes_total = 0.0
    lignes = db.query(LigneFacture).filter(LigneFacture.facture_id == facture_id).all()
    for lf in lignes:
        lignes_total += float(lf.abo or 0) + float(lf.conso or 0) + float(lf.remises or 0) + float(lf.achat or 0)
    facture_total = facture.total_ht
    ecart = facture_total - lignes_total

    if abs(ecart) < 0.01:
        return {
            "statut": "valide",
            "ecart": ecart,
            "commentaire": "Ecart nul : facture et lignes concordent.",
            "llm_summary": "",
            "rows_missing_count": 0,
        }

    if not facture.csv_id:
        return {
            "statut": "conteste",
            "ecart": ecart,
            "commentaire": f"Ecart facture-lignes de {ecart:.2f} € (aucun CSV associé pour analyse).",
            "llm_summary": "",
            "rows_missing_count": 0,
        }

    try:
        parsed = _parse_csv_rows_for_facture(facture.csv_id, facture.num)
        missing_rows = parsed["missing_access"]
        # Colonnes cles pour alleger le payload
        libelle_col = parsed.get("libelle_col")
        rubrique_col = parsed.get("rubrique_col")
        montant_col = parsed.get("montant_ht_col")
        import json

        slim_rows = []
        sum_rows_ht = 0.0
        for row in missing_rows[:20]:
            montant_raw = row.get(montant_col, "")
            try:
                val = float(str(montant_raw).replace(",", "."))
            except Exception:
                val = 0.0
            sum_rows_ht += val
            slim_rows.append(
                {
                    "Libelle": row.get(libelle_col, ""),
                    "Rubrique": row.get(rubrique_col, ""),
                    "Montant_HT": montant_raw,
                }
            )

        # Flags techniques
        ecart_explique = abs(ecart - sum_rows_ht) < 0.05
        etat_technique = "EXPLIQUE" if ecart_explique else "NON_EXPLIQUE"
        type_anomalie = "lignes_sans_acces" if missing_rows else "ecart_non_explique"

        # Pas d'IA : on construit un commentaire simple à partir des libellés
        lines_block = "; ".join(f"{r['Libelle']} ({r['Montant_HT']} HT)" for r in slim_rows) or "Aucune ligne listée."
        commentaire = (
            f"Ecart facture-lignes de {ecart:.2f} EUR. "
            f"Lignes sans accès détectées: {len(missing_rows)} (somme HT {sum_rows_ht:.2f} EUR). "
            f"Détails: {lines_block}"
        )

        # Analyse des groupes (type + prix abo) vs dernière facture validée
        def build_group_stats(facture_obj: Facture, rows_csv: Dict[str, Any] | None = None):
            stats = {}
            lf_rows = db.query(LigneFacture, Ligne).join(Ligne, LigneFacture.ligne_id == Ligne.id).filter(LigneFacture.facture_id == facture_obj.id).all()
            for lf, l in lf_rows:
                prix = float(lf.abo or 0) + float(lf.remises or 0)
                key = (l.type, round(prix, 2))
                if key not in stats:
                    stats[key] = {"count": 0, "total": 0.0, "ligne_nums": []}
                stats[key]["count"] += 1
                stats[key]["total"] += float(lf.total_ht)
                stats[key]["ligne_nums"].append(l.num)
            # attache éventuelles lignes CSV filtrées par access num pour contexte
            if rows_csv:
                access_col = rows_csv.get("access_col")
                rows_list = rows_csv.get("rows") or []
                if access_col:
                    for key, meta in stats.items():
                        nums = set(meta["ligne_nums"])
                        meta["csv_rows"] = [r for r in rows_list if str(r.get(access_col, "")).strip() in nums][:5]
            return stats

        current_stats = build_group_stats(facture, parsed)

        # dernière facture validée avant la date courante
        prev_valid = (
            db.query(Facture)
            .filter(
                Facture.compte_id == facture.compte_id,
                Facture.statut == 1,
                Facture.date < facture.date,
            )
            .order_by(Facture.date.desc())
            .first()
        )
        group_changes = []
        if prev_valid:
            prev_parsed = _parse_csv_rows_for_facture(prev_valid.csv_id, prev_valid.num) if prev_valid.csv_id else None
            prev_stats = build_group_stats(prev_valid, prev_parsed)
            keys = set(current_stats.keys()) | set(prev_stats.keys())
            for key in keys:
                curr = current_stats.get(key, {"count": 0, "total": 0.0, "ligne_nums": [], "csv_rows": []})
                prev = prev_stats.get(key, {"count": 0, "total": 0.0, "ligne_nums": [], "csv_rows": []})
                if abs(curr["count"] - prev["count"]) > 0 or abs(curr["total"] - prev["total"]) > 0.01:
                    type_code, prix = key
                    group_comment = (
                        f"Groupe type={type_code}, prix_abo={prix:.2f} : "
                        f"count {prev['count']} -> {curr['count']}, total {prev['total']:.2f} -> {curr['total']:.2f}."
                    )
                    # extrait quelques libellés CSV si dispo
                    samples = []
                    for r in curr.get("csv_rows", [])[:3]:
                        lib = r.get(parsed.get("libelle_col") or "", "")
                        samples.append(str(lib))
                    if samples:
                        group_comment += f" Exemples lignes: {', '.join(samples)}"
                    group_changes.append(group_comment)

        return {
            "statut": "conteste",
            "ecart": ecart,
            "commentaire": commentaire,
            "llm_summary": lines_block,
            "rows_missing_count": len(missing_rows),
            "etat_technique_ecart": etat_technique,
            "type_anomalie": type_anomalie,
            "group_changes": group_changes,
        }
    except Exception as exc:  # pragma: no cover - defensive
        logger.error("Auto-verif facture failed: %s", exc)
        return {
            "statut": "conteste",
            "ecart": ecart,
            "commentaire": f"Ecart facture-lignes de {ecart:.2f} € (analyse CSV indisponible).",
            "llm_summary": "",
            "rows_missing_count": 0,
        }


# ============================================================================
# AUTO-VERIF ETAPES SEPARÉES
# ============================================================================


class GroupeCheckPayload(BaseModel):
    ligne_type: int
    # prix_abo véhiculé comme net unitaire cible
    prix_abo: Optional[float] = None


def _build_group_stats(db: Session, facture_obj: Facture, rows_map: Optional[Dict[str, Any]] = None) -> Dict[tuple, Dict[str, Any]]:
    stats: Dict[tuple, Dict[str, Any]] = {}
    lf_rows = (
        db.query(LigneFacture, Ligne)
        .join(Ligne, LigneFacture.ligne_id == Ligne.id)
        .filter(LigneFacture.facture_id == facture_obj.id)
        .all()
    )
    for lf, l in lf_rows:
        prix = float(lf.abo or 0) + float(lf.remises or 0)
        key = (l.type, round(prix, 2))
        if key not in stats:
            stats[key] = {"count": 0, "total": 0.0, "ligne_nums": []}
        stats[key]["count"] += 1
        stats[key]["total"] += float(lf.total_ht)
        stats[key]["ligne_nums"].append(l.num)
    # attache un échantillon de rows CSV si fourni
    if rows_map:
        access_col = rows_map.get("access_col")
        lib_col = rows_map.get("libelle_col")
        rbq_col = rows_map.get("rubrique_col")
        by_access = rows_map.get("rows_by_access") or {}
        for key, meta in stats.items():
            samples = []
            for num in meta["ligne_nums"]:
                if str(num) in by_access:
                    for r in by_access[str(num)][:2]:
                        samples.append(
                            {
                                "access": num,
                                "libelle": r.get(lib_col, ""),
                                "rubrique": r.get(rbq_col, ""),
                            }
                        )
                if len(samples) >= 3:
                    break
            meta["csv_samples"] = samples
    return stats


def _closest_group(stats: Dict[tuple, Dict[str, Any]], ligne_type: int, target_unit: float, current_lignes: List[str]) -> Dict[str, Any]:
    """
    Sélectionne le groupe de référence le plus proche en combinant chevauchement des lignes
    et proximité de prix net unitaire.
    """
    candidates = [(k, v) for k, v in stats.items() if k[0] == ligne_type]
    if not candidates:
        return {"count": 0, "total": 0.0, "ligne_nums": [], "csv_samples": []}

    def score(kv):
        key, val = kv
        unit = val["total"] / val["count"] if val["count"] else 0.0
        overlap = len(set(val.get("ligne_nums", [])) & set(current_lignes))
        return (-overlap, abs(key[1] - target_unit))  # plus d'overlap = meilleur, sinon plus proche en prix

    best_key, best_val = min(candidates, key=score)
    return best_val


@app.post("/factures/{facture_id}/autoverif/ecart")
def auto_verif_ecart(facture_id: int, db: Session = Depends(get_db)):
    """Vérifie l'écart facture/lignes et les lignes sans accès (sans IA)."""
    facture = db.query(Facture).filter(Facture.id == facture_id).first()
    if not facture:
        raise HTTPException(status_code=404, detail="Facture non trouvée")

    lignes_total = 0.0
    lignes = db.query(LigneFacture).filter(LigneFacture.facture_id == facture_id).all()
    for lf in lignes:
        lignes_total += float(lf.abo or 0) + float(lf.conso or 0) + float(lf.remises or 0) + float(lf.achat or 0)
    facture_total = facture.total_ht
    ecart = facture_total - lignes_total

    if abs(ecart) < 0.01:
        return {
            "statut": "valide",
            "ecart": ecart,
            "commentaire": "Ecart nul : facture et lignes concordent.",
            "rows_missing_count": 0,
            "details": {},
            "montant_attendu": lignes_total,  # total des lignes
        }

    if not facture.csv_id:
        return {
            "statut": "conteste",
            "ecart": ecart,
            "commentaire": f"Ecart facture-lignes de {ecart:.2f} € (aucun CSV associé pour analyse).",
            "rows_missing_count": 0,
            "details": {},
            "montant_attendu": lignes_total,
        }

    parsed = _parse_csv_rows_for_facture(facture.csv_id, facture.num)
    missing_rows = parsed["missing_access"]
    # Colonnes cles pour alleger le payload
    libelle_col = parsed.get("libelle_col")
    rubrique_col = parsed.get("rubrique_col")
    montant_col = parsed.get("montant_ht_col")
    import json

    slim_rows = []
    sum_rows_ht = 0.0
    for row in missing_rows[:20]:
        montant_raw = row.get(montant_col, "")
        try:
            val = float(str(montant_raw).replace(",", "."))
        except Exception:
            val = 0.0
        sum_rows_ht += val
        slim_rows.append(
            {
                "Libelle": row.get(libelle_col, ""),
                "Rubrique": row.get(rubrique_col, ""),
                "Montant_HT": montant_raw,
            }
        )

    lines_block = "; ".join(f"{r['Libelle']} ({r['Montant_HT']} HT)" for r in slim_rows) or "Aucune ligne listée."
    commentaire = (
        f"Ecart facture-lignes de {ecart:.2f} EUR. "
        f"Lignes sans accès détectées: {len(missing_rows)} (somme HT {sum_rows_ht:.2f} EUR). "
        f"Détails: {lines_block}"
    )
    etat_technique = "EXPLIQUE" if abs(ecart - sum_rows_ht) < 0.05 else "NON_EXPLIQUE"
    type_anomalie = "lignes_sans_acces" if missing_rows else "ecart_non_explique"

    return {
        "statut": "conteste",
        "ecart": ecart,
        "commentaire": commentaire,
        "rows_missing_count": len(missing_rows),
        "etat_technique_ecart": etat_technique,
        "type_anomalie": type_anomalie,
        "montant_attendu": lignes_total,  # total lignes actuel (écart constaté)
        "details": {"lignes_sans_acces": slim_rows},
    }


@app.post("/factures/{facture_id}/autoverif/groupe")
def auto_verif_groupe(facture_id: int, payload: GroupeCheckPayload, db: Session = Depends(get_db)):
    """
    Verifie un type de lignes en comparant chaque ligne au dernier mois valide.
    Detecte les changements de prix abo net unitaire ou les nouvelles/suppressions.
    """
    facture = db.query(Facture).filter(Facture.id == facture_id).first()
    if not facture:
        raise HTTPException(status_code=404, detail="Facture non trouvee")

    type_label = {0: "Fixe", 1: "Mobile", 2: "Internet", 3: "Autre"}.get(payload.ligne_type, f"Type {payload.ligne_type}")

    parsed_current = _parse_csv_rows_for_facture(facture.csv_id, facture.num) if facture.csv_id else None
    rows_by_access = parsed_current.get("rows_by_access") if parsed_current else {}
    lib_col = parsed_current.get("libelle_col") if parsed_current else None

    def net_unit(lf: LigneFacture) -> float:
        return float(lf.abo or 0) + float(lf.remises or 0)

    curr_rows_all = (
        db.query(LigneFacture, Ligne)
        .join(Ligne, LigneFacture.ligne_id == Ligne.id)
        .filter(LigneFacture.facture_id == facture.id, Ligne.type == payload.ligne_type)
        .all()
    )
    def matches_price(lf: LigneFacture, target: Optional[float]) -> bool:
        if target is None:
            return True
        unit = net_unit(lf)
        return abs(unit - float(target)) < 0.01

    curr_rows = [(lf, l) for lf, l in curr_rows_all if matches_price(lf, payload.prix_abo)]
    # Si le filtre par prix exclut tout, on tombe en mode large (toutes les lignes du type)
    if payload.prix_abo is not None and len(curr_rows) == 0:
        curr_rows = curr_rows_all
    curr_map = {l.id: {"lf": lf, "ligne": l} for lf, l in curr_rows}
    curr_total_ht = sum(float(lf.total_ht or 0) for lf, _ in curr_rows)
    curr_count = len(curr_rows)

    prev_valid = (
        db.query(Facture)
        .filter(
            Facture.compte_id == facture.compte_id,
            Facture.statut == 1,
            Facture.date < facture.date,
        )
        .order_by(Facture.date.desc())
        .first()
    )
    if prev_valid and prev_valid.id != facture.id:
        prev_rows_all = (
            db.query(LigneFacture, Ligne)
            .join(Ligne, LigneFacture.ligne_id == Ligne.id)
            .filter(LigneFacture.facture_id == prev_valid.id, Ligne.type == payload.ligne_type)
            .all()
        )
        prev_rows = [(lf, l) for lf, l in prev_rows_all if matches_price(lf, payload.prix_abo)]
        if payload.prix_abo is not None and len(prev_rows) == 0:
            prev_rows = prev_rows_all
        prev_map = {l.id: {"lf": lf, "ligne": l} for lf, l in prev_rows}
        has_reference = True
    else:
        prev_map = {}
        has_reference = False
        logger.info("[AUTO][GROUPE] aucune facture validee precedente | facture_id=%s | type=%s", facture_id, payload.ligne_type)

    anomalies: list[str] = []
    anomalies_detail: list[Dict[str, Any]] = []
    context_entries: list[str] = []

    for ligne_id, data in curr_map.items():
        lf = data["lf"]
        l = data["ligne"]
        curr_net = net_unit(lf)
        # Flag achats non nuls
        try:
            achat_val = float(lf.achat or 0)
        except Exception:
            achat_val = 0.0
        if abs(achat_val) > 0.01:
            label_achat = f"Ligne {l.num}: achat HT {achat_val:.2f} EUR"
            rows = (rows_by_access or {}).get(str(l.num), [])[:1]
            csv_info = {}
            if rows:
                csv_info = rows[0]
            if rows and lib_col:
                rbq_col = parsed_current.get("rubrique_col") if parsed_current else None
                label_achat += f" ({rows[0].get(lib_col,'')}"
                if rbq_col:
                    label_achat += f" / {rows[0].get(rbq_col,'')}"
                label_achat += ")"
            anomalies.append(label_achat)
            anomalies_detail.append({"line": l.num, "kind": "achat", "detail": label_achat, "csv": csv_info})
            context_entries.append(label_achat)
        prev_data = prev_map.get(ligne_id)
        if prev_data:
            prev_net = net_unit(prev_data["lf"])
            if abs(curr_net - prev_net) > 0.01:
                label = f"Ligne {l.num}: abo net {prev_net:.2f} -> {curr_net:.2f} EUR"
                rows = (rows_by_access or {}).get(str(l.num), [])[:1]
                csv_info = rows[0] if rows else {}
                if rows and lib_col:
                    label += f" ({rows[0].get(lib_col,'')})"
                anomalies.append(label)
                anomalies_detail.append(
                    {"line": l.num, "kind": "net_change", "detail": label, "prev_net": prev_net, "curr_net": curr_net, "csv": csv_info}
                )
                context_entries.append(label)
        else:
            label = f"Ligne {l.num}: nouvelle ligne a {curr_net:.2f} EUR net"
            rows = (rows_by_access or {}).get(str(l.num), [])[:1]
            csv_info = rows[0] if rows else {}
            if rows and lib_col:
                label += f" ({rows[0].get(lib_col,'')})"
            anomalies.append(label)
            anomalies_detail.append({"line": l.num, "kind": "added", "detail": label, "curr_net": curr_net, "csv": csv_info})
            context_entries.append(label)

    for ligne_id, data in prev_map.items():
        if ligne_id not in curr_map:
            l = data["ligne"]
            msg = f"Ligne {l.num}: absente ce mois-ci (precedemment presente)"
            anomalies.append(msg)
            anomalies_detail.append({"line": l.num, "kind": "removed", "detail": msg})

    prev_total_ht = sum(float(v["lf"].total_ht or 0) for v in prev_map.values())
    prev_count = len(prev_map)
    delta_count = curr_count - prev_count
    delta_total = curr_total_ht - prev_total_ht

    if not has_reference:
        target_str = f"{payload.prix_abo:.2f} EUR net" if payload.prix_abo is not None else "net unitaire inconnu"
        commentaire = (
            f"Groupe {type_label}: aucune facture validee de reference pour ce groupe (cible {target_str}). "
            f"Lignes: {curr_count}, total HT du groupe: {curr_total_ht:.2f} EUR. "
            "Verification manuelle recommandee."
        )
        statut = "conteste"
    elif anomalies:
        commentaire = f"Groupe {type_label}: variations detectees. " + " ; ".join(anomalies)
        statut = "conteste"
    else:
        summary: dict[float, int] = {}
        for lf, _ in curr_rows:
            price = round(net_unit(lf), 2)
            summary[price] = summary.get(price, 0) + 1
        repartition = "; ".join(f"{cnt} ligne(s) a {price:.2f} EUR net" for price, cnt in sorted(summary.items()))
        commentaire = f"Groupe {type_label}: aucun changement detecte. Repartition: {repartition or 'n/a'}."
        statut = "valide" if curr_count > 0 else "conteste"

    logger.info(
        "[AUTO][GROUPE] facture_id=%s type=%s | prev={count:%s,total:%s} | curr={count:%s,total:%s} | anomalies=%d | statut=%s",
        facture_id,
        payload.ligne_type,
        prev_count,
        prev_total_ht,
        curr_count,
        curr_total_ht,
        len(anomalies),
        statut,
    )

    return {
        "statut": statut,
        "commentaire": commentaire,
        "montant_attendu": curr_total_ht,
        "delta_count": delta_count,
        "delta_total": delta_total,
        "csv_context": context_entries,
        "anomalies": anomalies_detail,
    }

# ============================================================================ 
# LLM local (Ollama Qwen2.5-0.5B)
# ============================================================================

class LlmSummarizeRequest(BaseModel):
    texts: List[str]
    system: Optional[str] = None


@app.post("/llm/summarize")
def llm_summarize(payload: LlmSummarizeRequest):
    """
    Répond en JSON structuré en s'appuyant sur Ollama (qwen2.5:0.5b).
    Le modele doit etre pre-telecharge via `ollama pull qwen2.5:0.5b`.
    """
    if not payload.texts:
        raise HTTPException(status_code=400, detail="Aucun texte fourni")

    system_prompt = payload.system or (
        "Tu es un assistant qui renvoie uniquement un objet JSON pour résumer des anomalies de facturation."
    )
    user_content = "\n".join(payload.texts)
    parsed = _call_llm_structured(user_content, system_prompt)
    return parsed

# ============================================================================
# ENDPOINTS - COMPTES
# ============================================================================

@app.get("/comptes", response_model=List[CompteResponse])
def list_comptes(entreprise_id: Optional[int] = None, db: Session = Depends(get_db)):
    """Liste tous les comptes, optionnellement filtrés par entreprise."""
    query = db.query(Compte)
    if entreprise_id:
        query = query.filter(Compte.entreprise_id == entreprise_id)
    return query.all()


@app.post("/comptes", response_model=CompteResponse)
def create_compte(compte: CompteCreate, db: Session = Depends(get_db)):
    """Crée un nouveau compte."""
    logger.info(f"Création compte: num={compte.num}, entreprise_id={compte.entreprise_id}")
    db_compte = Compte(**compte.dict())
    db.add(db_compte)
    try:
        db.commit()
        db.refresh(db_compte)
        logger.info(f"Compte créé: id={db_compte.id}")
        return db_compte
    except Exception as e:
        db.rollback()
        logger.error(f"Erreur création compte: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/comptes/{compte_id}", response_model=CompteResponse)
def get_compte(compte_id: int, db: Session = Depends(get_db)):
    """Récupère un compte par ID."""
    compte = db.query(Compte).filter(Compte.id == compte_id).first()
    if not compte:
        raise HTTPException(status_code=404, detail="Compte non trouvé")
    return compte


@app.put("/comptes/{compte_id}", response_model=CompteResponse)
def update_compte(compte_id: int, compte: CompteUpdate, db: Session = Depends(get_db)):
    """Met à jour un compte."""
    db_compte = db.query(Compte).filter(Compte.id == compte_id).first()
    if not db_compte:
        raise HTTPException(status_code=404, detail="Compte non trouvé")

    if compte.nom is not None:
        db_compte.nom = compte.nom
    if compte.lot is not None:
        db_compte.lot = compte.lot

    try:
        db.commit()
        db.refresh(db_compte)
        return db_compte
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))


@app.delete("/comptes/{compte_id}")
def delete_compte(compte_id: int, db: Session = Depends(get_db)):
    """Supprime un compte et toutes ses données."""
    db_compte = db.query(Compte).filter(Compte.id == compte_id).first()
    if not db_compte:
        raise HTTPException(status_code=404, detail="Compte non trouvé")

    db.delete(db_compte)
    db.commit()
    return {"message": "Compte supprimé"}


# ============================================================================
# ENDPOINTS - LIGNES
# ============================================================================

@app.get("/lignes", response_model=List[LigneResponse])
def list_lignes(compte_id: Optional[int] = None, db: Session = Depends(get_db)):
    """Liste toutes les lignes, optionnellement filtrées par compte."""
    query = db.query(Ligne)
    if compte_id:
        query = query.filter(Ligne.compte_id == compte_id)
    return query.all()


@app.post("/lignes", response_model=LigneResponse)
def create_ligne(ligne: LigneCreate, db: Session = Depends(get_db)):
    """Crée une nouvelle ligne."""
    db_ligne = Ligne(**ligne.dict())
    db.add(db_ligne)
    try:
        db.commit()
        db.refresh(db_ligne)
        return db_ligne
    except Exception as e:
        db.rollback()
        logger.error(f"Erreur création ligne: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/lignes/{ligne_id}", response_model=LigneResponse)
def get_ligne(ligne_id: int, db: Session = Depends(get_db)):
    """Récupère une ligne par ID."""
    ligne = db.query(Ligne).filter(Ligne.id == ligne_id).first()
    if not ligne:
        raise HTTPException(status_code=404, detail="Ligne non trouvée")
    return ligne


@app.put("/lignes/{ligne_id}", response_model=LigneResponse)
def update_ligne(ligne_id: int, ligne: LigneUpdate, db: Session = Depends(get_db)):
    """Met à jour une ligne."""
    db_ligne = db.query(Ligne).filter(Ligne.id == ligne_id).first()
    if not db_ligne:
        raise HTTPException(status_code=404, detail="Ligne non trouvée")

    if ligne.type is not None:
        db_ligne.type = ligne.type

    try:
        db.commit()
        db.refresh(db_ligne)
        return db_ligne
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))


@app.delete("/lignes/{ligne_id}")
def delete_ligne(ligne_id: int, db: Session = Depends(get_db)):
    """Supprime une ligne."""
    db_ligne = db.query(Ligne).filter(Ligne.id == ligne_id).first()
    if not db_ligne:
        raise HTTPException(status_code=404, detail="Ligne non trouvée")

    db.delete(db_ligne)
    db.commit()
    return {"message": "Ligne supprimée"}


# ============================================================================
# ENDPOINTS - FACTURES
# ============================================================================

@app.get("/factures", response_model=List[FactureResponse])
def list_factures(
    compte_id: Optional[int] = None,
    entreprise_id: Optional[int] = None,
    date_debut: Optional[date] = None,
    date_fin: Optional[date] = None,
    db: Session = Depends(get_db)
):
    """Liste toutes les factures avec filtres optionnels."""
    query = db.query(Facture)

    if compte_id:
        query = query.filter(Facture.compte_id == compte_id)

    if entreprise_id:
        query = query.join(Compte).filter(Compte.entreprise_id == entreprise_id)

    if date_debut:
        query = query.filter(Facture.date >= date_debut)

    if date_fin:
        query = query.filter(Facture.date <= date_fin)

    return query.all()


@app.post("/factures", response_model=FactureResponse)
def create_facture(facture: FactureCreate, db: Session = Depends(get_db)):
    """Crée une nouvelle facture."""
    logger.info(f"Création facture: num={facture.num}, compte_id={facture.compte_id}, date={facture.date}")
    db_facture = Facture(**facture.dict())
    db.add(db_facture)
    try:
        db.commit()
        db.refresh(db_facture)
        logger.info(f"Facture créée: id={db_facture.id}, total_ht={db_facture.total_ht}")
        return db_facture
    except Exception as e:
        db.rollback()
        logger.error(f"Erreur création facture: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/factures/{facture_id}", response_model=FactureResponse)
def get_facture(facture_id: int, db: Session = Depends(get_db)):
    """Récupère une facture par ID."""
    facture = db.query(Facture).filter(Facture.id == facture_id).first()
    if not facture:
        raise HTTPException(status_code=404, detail="Facture non trouvée")
    return facture


@app.put("/factures/{facture_id}", response_model=FactureResponse)
def update_facture(
    facture_id: int, facture: FactureUpdate, db: Session = Depends(get_db)
):
    """Met à jour une facture."""
    logger.info(f"[FACTURE][UPDATE][REQUEST] id={facture_id} payload={facture}")
    db_facture = db.query(Facture).filter(Facture.id == facture_id).first()
    if not db_facture:
        raise HTTPException(status_code=404, detail="Facture non trouvée")

    if facture.abo is not None:
        db_facture.abo = facture.abo
    if facture.conso is not None:
        db_facture.conso = facture.conso
    if facture.remises is not None:
        db_facture.remises = facture.remises
    if facture.achat is not None:
        db_facture.achat = facture.achat
    if facture.statut is not None:
        db_facture.statut = facture.statut
    if facture.csv_id is not None:
        db_facture.csv_id = facture.csv_id

    try:
        db.commit()
        db.refresh(db_facture)
        logger.info(f"[FACTURE][UPDATE][SUCCESS] id={facture_id} statut={db_facture.statut}")
        return db_facture
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))


@app.delete("/factures/{facture_id}")
def delete_facture(facture_id: int, db: Session = Depends(get_db)):
    """Supprime une facture."""
    db_facture = db.query(Facture).filter(Facture.id == facture_id).first()
    if not db_facture:
        raise HTTPException(status_code=404, detail="Facture non trouvée")

    db.delete(db_facture)
    db.commit()
    return {"message": "Facture supprimée"}



# ============================================================================
# ENDPOINTS - RAPPORT FACTURE
# ============================================================================

@app.get("/factures/{facture_id}/rapport", response_model=FactureReportResponse)
def get_facture_report(facture_id: int, db: Session = Depends(get_db)):
    """Recupere le rapport/commentaire/stats d'une facture."""
    report = db.query(FactureReport).filter(FactureReport.facture_id == facture_id).first()
    if not report:
        raise HTTPException(status_code=404, detail="Rapport non trouve")
    return report


@app.put("/factures/{facture_id}/rapport", response_model=FactureReportResponse)
def upsert_facture_report(
    facture_id: int,
    payload: FactureReportPayload,
    db: Session = Depends(get_db),
):
    """Cree ou met a jour le rapport d'une facture (commentaire + data)."""
    logger.info(f"[RAPPORT][UPSERT][REQUEST] facture_id={facture_id} payload_keys={list(payload.dict().keys())}")
    db_facture = db.query(Facture).filter(Facture.id == facture_id).first()
    if not db_facture:
        raise HTTPException(status_code=404, detail="Facture non trouvee")

    report = db.query(FactureReport).filter(FactureReport.facture_id == facture_id).first()
    if not report:
        report = FactureReport(facture_id=facture_id)
        db.add(report)

    report.commentaire = payload.commentaire
    report.data = payload.data

    try:
        db.commit()
        db.refresh(report)
        logger.info(f"[RAPPORT][UPSERT][SUCCESS] facture_id={facture_id}")
        return report
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))


# ============================================================================
# ENDPOINTS - LIGNES-FACTURES
# ============================================================================

@app.get("/lignes-factures", response_model=List[LigneFactureResponse])
def list_lignes_factures(
    facture_id: Optional[int] = None,
    ligne_id: Optional[int] = None,
    db: Session = Depends(get_db)
):
    """Liste toutes les liaisons ligne-facture avec filtres optionnels."""
    query = db.query(LigneFacture)

    if facture_id:
        query = query.filter(LigneFacture.facture_id == facture_id)

    if ligne_id:
        query = query.filter(LigneFacture.ligne_id == ligne_id)

    return query.all()


@app.post("/lignes-factures", response_model=LigneFactureResponse)
def create_ligne_facture(ligne_facture: LigneFactureCreate, db: Session = Depends(get_db)):
    """Crée une nouvelle liaison ligne-facture."""
    db_ligne_facture = LigneFacture(**ligne_facture.dict())
    db.add(db_ligne_facture)
    try:
        db.commit()
        db.refresh(db_ligne_facture)
        return db_ligne_facture
    except Exception as e:
        db.rollback()
        logger.error(f"Erreur création ligne-facture: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/lignes-factures/{ligne_facture_id}", response_model=LigneFactureResponse)
def get_ligne_facture(ligne_facture_id: int, db: Session = Depends(get_db)):
    """Récupère une liaison ligne-facture par ID."""
    ligne_facture = db.query(LigneFacture).filter(LigneFacture.id == ligne_facture_id).first()
    if not ligne_facture:
        raise HTTPException(status_code=404, detail="Liaison ligne-facture non trouvée")
    return ligne_facture


@app.put("/lignes-factures/{ligne_facture_id}", response_model=LigneFactureResponse)
def update_ligne_facture(
    ligne_facture_id: int, ligne_facture: LigneFactureUpdate, db: Session = Depends(get_db)
):
    """Met à jour une liaison ligne-facture."""
    db_ligne_facture = db.query(LigneFacture).filter(LigneFacture.id == ligne_facture_id).first()
    if not db_ligne_facture:
        raise HTTPException(status_code=404, detail="Liaison ligne-facture non trouvée")

    if ligne_facture.abo is not None:
        db_ligne_facture.abo = ligne_facture.abo
    if ligne_facture.conso is not None:
        db_ligne_facture.conso = ligne_facture.conso
    if ligne_facture.remises is not None:
        db_ligne_facture.remises = ligne_facture.remises
    if ligne_facture.achat is not None:
        db_ligne_facture.achat = ligne_facture.achat

    try:
        db.commit()
        db.refresh(db_ligne_facture)
        return db_ligne_facture
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))


@app.delete("/lignes-factures/{ligne_facture_id}")
def delete_ligne_facture(ligne_facture_id: int, db: Session = Depends(get_db)):
    """Supprime une liaison ligne-facture."""
    db_ligne_facture = db.query(LigneFacture).filter(LigneFacture.id == ligne_facture_id).first()
    if not db_ligne_facture:
        raise HTTPException(status_code=404, detail="Liaison ligne-facture non trouvée")

    db.delete(db_ligne_facture)
    db.commit()
    return {"message": "Liaison ligne-facture supprimée"}


# ============================================================================
# ENDPOINT - REQUÊTES PERSONNALISÉES (lecture seule)
# ============================================================================

@app.post("/query")
def execute_query(query_request: Dict[str, str], db: Session = Depends(get_db)):
    """
    Exécute une requête SQL personnalisée (SELECT uniquement).

    Body: {"sql": "SELECT * FROM entreprises"}
    """
    sql = query_request.get("sql", "").strip().upper()

    # Sécurité: autoriser uniquement les SELECT
    if not sql.startswith("SELECT"):
        raise HTTPException(
            status_code=400, detail="Seules les requêtes SELECT sont autorisées"
        )

    try:
        result = db.execute(text(query_request["sql"]))
        rows = [dict(row._mapping) for row in result]
        return {"data": rows, "count": len(rows)}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# ============================================================================
# ENDPOINT - HEALTH CHECK
# ============================================================================

@app.get("/")
def root():
    """Health check."""
    return {"status": "ok", "message": "API Vérification Factures Télécom"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

@app.post("/uploads")
def upload_csv(
    file: UploadFile = File(...),
    entreprise_name: str = Form("SansNom"),
    category: str = Form("import_manual"),
    date_min: Optional[str] = Form(None),
    date_max: Optional[str] = Form(None),
):
    """Stocke un CSV (copie disque + métadonnée). Ne modifie pas la base SQL."""
    content = file.file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Fichier vide")
    logger.info(
        "Stockage CSV via /uploads | entreprise=%s | category=%s | date_min=%s | date_max=%s | filename=%s",
        entreprise_name,
        category,
        date_min,
        date_max,
        file.filename,
    )
    try:
        stored = store_csv_file(
            content=content,
            original_name=file.filename or "upload.csv",
            category=category,
            entreprise=entreprise_name,
            extra_metadata={
                "date_min": date_min,
                "date_max": date_max,
            },
        )
        logger.info(
            "CSV stocké via /uploads: name=%s, entreprise=%s, category=%s, existing=%s",
            file.filename,
            entreprise_name,
            category,
            stored.existing,
        )
        return {"success": True, "upload": stored.to_dict()}
    except StorageError as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    except Exception as exc:  # pragma: no cover - defensive
        logger.error("Erreur stockage CSV: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur stockage CSV")
