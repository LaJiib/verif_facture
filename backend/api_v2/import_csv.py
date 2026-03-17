"""Import CSV usecase logic (migration of frontend csvImporter to backend)."""

from __future__ import annotations

import csv
import io
import json
import logging
import re
from datetime import datetime, date
from decimal import Decimal
from collections import Counter
from typing import Dict, List, Optional, Tuple, Any

from fastapi import HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func

from ..models import Compte, Ligne, Facture, LigneFacture, Abonnement, LigneAbonnement

logger = logging.getLogger("api_v2.import_csv")

MONTANT_FIELDS = ("abo", "conso", "remises", "achat")
CONFLIT_EPSILON = 0.01


def _as_amount(value: Any) -> float:
    try:
        amount = round(float(value or 0), 2)
    except Exception:
        amount = 0.0
    return 0.0 if abs(amount) < 0.005 else amount


def _amounts_from_obj(source: Any) -> Dict[str, float]:
    return {field: _as_amount(getattr(source, field, 0)) for field in MONTANT_FIELDS}


def _amounts_from_dict(source: Optional[Dict[str, Any]]) -> Dict[str, float]:
    data = source or {}
    return {field: _as_amount(data.get(field, 0)) for field in MONTANT_FIELDS}


def _compute_delta(ancien: Dict[str, float], nouveau: Dict[str, float]) -> Dict[str, float]:
    return {field: _as_amount(nouveau.get(field, 0) - ancien.get(field, 0)) for field in MONTANT_FIELDS}


def _has_conflict(delta: Dict[str, float]) -> bool:
    return any(abs(delta.get(field, 0)) > CONFLIT_EPSILON for field in MONTANT_FIELDS)


# ===================== PARSING / MAPPING =====================

REQUIRED_COLUMNS = ("numeroCompte", "numeroFacture", "date", "montantHT", "numeroAcces")
OPTIONAL_COLUMNS = ("typeAcces", "libelleDetail", "rubriqueFacture", "niveauCharge", "typeCharge", "nomLigne", "sousCompte")
DEFAULT_BACKEND_CSV_FORMAT = {
    "id": "orange",
    "name": "Format Orange (défaut)",
    "dateFormat": "DD/MM/YYYY",
    "columns": {
        "numeroCompte": "Numéro compte",
        "numeroAcces": "Numéro accès",
        "numeroFacture": "Numéro facture",
        "date": "Date",
        "typeAcces": "Type d'accès",
        "libelleDetail": "Libellé ligne facture",
        "rubriqueFacture": "Rubrique facture",
        "montantHT": "Montant (€ HT)",
        "niveauCharge": "Niveau de charge",
        "typeCharge": "Type de charge",
        "nomLigne": "Nom ligne",
        "sousCompte": "Sous-compte",
    },
}


def _clean_column_value(value: Any) -> Optional[str]:
    if value is None:
        return None
    try:
        text = str(value).strip()
    except Exception:
        return None
    return text or None


def normalize_format_cfg(format_cfg: Optional[Dict]) -> Dict:
    """
    Applique le format fourni (côté frontend) et valide les colonnes obligatoires.
    Utilise le format par défaut si rien n'est transmis.
    """
    base_cfg = format_cfg if isinstance(format_cfg, dict) and format_cfg else DEFAULT_BACKEND_CSV_FORMAT
    columns_raw = base_cfg.get("columns") or {}
    columns: Dict[str, Optional[str]] = {}
    for key in (*REQUIRED_COLUMNS, *OPTIONAL_COLUMNS):
        columns[key] = _clean_column_value(columns_raw.get(key))

    missing = [col for col in REQUIRED_COLUMNS if not columns.get(col)]
    if missing:
        raise HTTPException(status_code=400, detail=f"Colonnes obligatoires manquantes dans le format: {', '.join(missing)}")

    return {
        "dateFormat": base_cfg.get("dateFormat") or "DD/MM/YYYY",
        "columns": columns,
    }


def _encode_line_type(label: Optional[str]) -> int:
    if not label:
        return 3
    key = label.strip().lower()
    mapping = {
        "fixe": 0,
        "fixe secondaire": 0,
        "mobile": 1,
        "internet": 2,
        "internet bas debit": 2,
    }
    return mapping.get(key, 3)


def _detect_type_ligne(numero_acces: Optional[str], type_acces: Optional[str], libelle_detail: Optional[str]) -> Tuple[int, str]:
    """Détection prioritaire par format du numéro, sinon heuristique texte."""
    num = (numero_acces or "").strip()
    if num and len(num) == 10 and num.isdigit():
        if num.startswith(("06", "07")):
            label = "Mobile"
        else:
            label = "Fixe"
        return _encode_line_type(label), label

    if not type_acces and not libelle_detail:
        return 3, "Autre"
    text = f"{type_acces or ''} {libelle_detail or ''}".lower()
    label = "Autre"
    if any(k in text for k in ["adsl", "rnis", "numeris", "bas debit", "bas debit"]):
        label = "Internet bas debit"
    elif any(k in text for k in ["internet", "fibre", "ftth", "sdsl", "vdsl"]):
        label = "Internet"
    elif any(k in text for k in ["secondaire", "terminal", "poste supplementaire", "poste supplementaire"]):
        label = "Fixe secondaire"
    return _encode_line_type(label), label


def _parse_date(raw: str, date_format: str = "DD/MM/YYYY") -> Optional[date]:
    if not raw:
        return None
    raw = raw.strip()
    try:
        if date_format == "YYYY-MM-DD" or raw.count("-") == 2 and len(raw.split("-")[0]) == 4:
            return datetime.strptime(raw, "%Y-%m-%d").date()
        # default DD/MM/YYYY
        return datetime.strptime(raw, "%d/%m/%Y").date()
    except Exception:
        return None


def _get_cell(row: Dict[str, str], column: Optional[str]) -> Optional[str]:
    if not column:
        return None
    if column in row:
        return row.get(column)
    normalized = column.strip().lower()
    for k, v in row.items():
        if not k:
            continue
        try:
            key_norm = k.strip().lower()
        except Exception:
            continue
        if key_norm == normalized:
            return v
    return None


def _parse_amount(val: Any) -> Optional[float]:
    if val is None:
        return None
    try:
        text = str(val).strip()
    except Exception:
        return None
    if not text:
        return None
    # Nettoie les separateurs de milliers et symboles (€ , espaces insécables, tabs)
    text = text.replace("\u00a0", " ").replace("\t", " ").strip()
    # Garde uniquement chiffres, signes, points, virgules
    cleaned = re.sub(r"[^0-9,.\-]", "", text)
    if not cleaned:
        return None
    # Cas "1.234,56" -> enlever les points (milliers) et utiliser la virgule pour decimales
    if "," in cleaned and "." in cleaned:
        cleaned = cleaned.replace(".", "").replace(",", ".")
    elif "," in cleaned:
        cleaned = cleaned.replace(",", ".")
    try:
        return float(cleaned)
    except Exception:
        return None


def extract_rows_data(rows: List[Dict[str, str]], format_cfg: Dict) -> List[Dict]:
    """Equivalent a extractLignesData cote frontend."""
    format_cfg = normalize_format_cfg(format_cfg)
    fmt_cols = format_cfg.get("columns", {})
    date_fmt = format_cfg.get("dateFormat") or "DD/MM/YYYY"
    lignes = []
    skipped = 0
    missing_stats: Counter[str] = Counter()
    for row in rows:
        numero_compte = (_get_cell(row, fmt_cols.get("numeroCompte")) or "").strip()
        numero_acces = (_get_cell(row, fmt_cols.get("numeroAcces")) or "").strip() or None
        numero_facture = (_get_cell(row, fmt_cols.get("numeroFacture")) or "").strip()
        raw_date = _get_cell(row, fmt_cols.get("date"))
        date_parsed = _parse_date(raw_date or "", date_fmt)
        type_acces = (_get_cell(row, fmt_cols.get("typeAcces")) or "").strip()
        libelle_detail = (_get_cell(row, fmt_cols.get("libelleDetail")) or "").strip()
        rubrique = (_get_cell(row, fmt_cols.get("rubriqueFacture")) or "").strip()
        nom_ligne = (_get_cell(row, fmt_cols.get("nomLigne")) or "").strip()
        sous_compte = (_get_cell(row, fmt_cols.get("sousCompte")) or "").strip()
        montant_raw = _get_cell(row, fmt_cols.get("montantHT"))
        missing_reasons: List[str] = []
        if not numero_compte:
            missing_reasons.append("numeroCompte")
        if not numero_facture:
            missing_reasons.append("numeroFacture")
        if not date_parsed:
            missing_reasons.append("date")
        montant = _parse_amount(montant_raw)
        if montant is None:
            missing_reasons.append("montantHT_invalide")
        niveau_charge = (_get_cell(row, fmt_cols.get("niveauCharge")) or "").strip().lower()
        type_charge = (_get_cell(row, fmt_cols.get("typeCharge")) or "").strip().lower()

        if missing_reasons or montant is None:
            skipped += 1
            for reason in missing_reasons:
                missing_stats[reason] += 1
            continue
        type_code, type_label = _detect_type_ligne(numero_acces, type_acces, libelle_detail)
        lignes.append(
            {
                "numeroCompte": numero_compte,
                "numeroAcces": numero_acces,
                "numeroFacture": numero_facture,
                "date": date_parsed.isoformat(),
                "typeCode": type_code,
                "typeLabel": type_label,
                "montantHT": montant,
                "niveauCharge": niveau_charge,
                "typeCharge": type_charge,
                "libelleDetail": libelle_detail,
                "rubriqueFacture": rubrique,
                "nomLigne": nom_ligne or None,
                "sousCompte": sous_compte or None,
            }
        )
    if skipped:
        top_reasons = ", ".join([f"{k}:{v}" for k, v in missing_stats.most_common(5)])
        logger.warning("Lignes ignorees (manque donnees): %s/%s. Manquants: %s", skipped, len(rows), top_reasons or "n/a")
    return lignes


def _normalize_text(*parts: str) -> str:
    import unicodedata

    text = " ".join(parts)
    return unicodedata.normalize("NFD", text).encode("ascii", "ignore").decode().lower()


def categorize_montant(ligne: Dict) -> str:
    rubrique = _normalize_text(ligne.get("rubriqueFacture") or "")
    montant = ligne.get("montantHT") or 0
    is_negative = montant < 0

    if any(k in rubrique for k in ["consommations"]):
        # Les consommations negatives restent dans conso (pas en remises)
        return "conso"

    if any(k in rubrique for k in ["ponctuels", "terminaux"]):
        # Les achats negatifs restent dans achat (pas en remises)
        return "achat"

    if any(k in rubrique for k in ["abonnements", "forfaits", "remises"]):
        # Les remises ne concernent que les depenses d'abonnement negatives
        return "remises" if is_negative else "abo"

    # Fallback: sans rubrique reconnue, on classe en abo sans bascule automatique vers remises.
    return "abo"


def aggregate_factures_data(rows_data: List[Dict]) -> List[Dict]:
    factures_map: Dict[str, Dict] = {}
    for ligne in rows_data:
        key = f"{ligne['numeroCompte']}|{ligne['numeroFacture']}|{ligne['date']}"
        if key not in factures_map:
            factures_map[key] = {
                "numeroCompte": ligne["numeroCompte"],
                "numeroFacture": ligne["numeroFacture"],
                "date": ligne["date"],
                "abo": 0.0,
                "conso": 0.0,
                "remises": 0.0,
                "achat": 0.0,
                "hors_ligne": {"abo": 0.0, "conso": 0.0, "remises": 0.0, "achat": 0.0},
                "lignes": [],
            }
        facture = factures_map[key]
        category = categorize_montant(ligne)
        abo = conso = remises = achat = 0.0
        if category == "abo":
            abo = ligne["montantHT"]
            facture["abo"] += abo
        elif category == "conso":
            conso = ligne["montantHT"]
            facture["conso"] += conso
        elif category == "remises":
            remises = ligne["montantHT"]
            facture["remises"] += remises
        elif category == "achat":
            achat = ligne["montantHT"]
            facture["achat"] += achat

        # Ventile uniquement si numeroAcces present et non vide
        numero_acces = (ligne.get("numeroAcces") or "").strip()
        if numero_acces:
            existing = next((l for l in facture["lignes"] if l["numeroAcces"] == numero_acces), None)
            if not existing:
                existing = {
                    "numeroAcces": numero_acces,
                    "type": ligne["typeCode"],
                    "abo": 0.0,
                    "conso": 0.0,
                    "remises": 0.0,
                    "achat": 0.0,
                    "nomLigne": ligne.get("nomLigne"),
                    "sousCompte": ligne.get("sousCompte"),
                }
                facture["lignes"].append(existing)
            else:
                if not existing.get("nomLigne") and ligne.get("nomLigne"):
                    existing["nomLigne"] = ligne.get("nomLigne")
                if not existing.get("sousCompte") and ligne.get("sousCompte"):
                    existing["sousCompte"] = ligne.get("sousCompte")
            existing["abo"] += abo
            existing["conso"] += conso
            existing["remises"] += remises
            existing["achat"] += achat
        else:
            # Montants sans numeroAcces: conserves pour le total facture mais non affectes aux lignes
            facture["hors_ligne"]["abo"] += abo
            facture["hors_ligne"]["conso"] += conso
            facture["hors_ligne"]["remises"] += remises
            facture["hors_ligne"]["achat"] += achat
    return list(factures_map.values())


# ===================== IMPORT EXECUTION =====================


def _get_or_create_compte(db: Session, entreprise_id: int, num: str, nom: Optional[str], lot: Optional[str]) -> Compte:
    compte = db.query(Compte).filter(Compte.num == num, Compte.entreprise_id == entreprise_id).first()
    if compte:
        return compte
    compte = Compte(num=num.strip(), nom=nom, entreprise_id=entreprise_id, lot=lot)
    db.add(compte)
    db.commit()
    db.refresh(compte)
    return compte


def _get_or_create_ligne(
    db: Session, compte_id: int, numero_acces: str, type_code: int, nom: Optional[str] = None, sous_compte: Optional[str] = None
) -> Ligne:
    ligne = db.query(Ligne).filter(Ligne.compte_id == compte_id, Ligne.num == numero_acces).first()
    if ligne:
        updated = False
        if nom and (not ligne.nom or ligne.nom.strip() == ""):
            ligne.nom = nom.strip()
            updated = True
        if sous_compte and (not ligne.sous_compte or ligne.sous_compte.strip() == ""):
            ligne.sous_compte = sous_compte.strip()
            updated = True
        if type_code is not None and ligne.type != type_code:
            ligne.type = type_code
            updated = True
        if updated:
            db.add(ligne)
            db.commit()
            db.refresh(ligne)
        return ligne
    ligne = Ligne(num=numero_acces, type=type_code, compte_id=compte_id, nom=(nom or None), sous_compte=(sous_compte or None))
    db.add(ligne)
    db.commit()
    db.refresh(ligne)
    return ligne


def _get_or_create_abonnement(
    db: Session, nom: str, prix: float, entreprise_id: int, commentaire: Optional[str] = None
) -> Tuple[Abonnement, bool]:
    ab = (
        db.query(Abonnement)
        .filter(func.lower(Abonnement.nom) == nom.strip().lower(), Abonnement.entreprise_id == entreprise_id)
        .first()
    )
    if ab:
        return ab, False
    ab = Abonnement(
        nom=nom.strip(),
        prix=Decimal(str(round(prix, 2))),
        commentaire=commentaire,
        entreprise_id=entreprise_id,
    )
    db.add(ab)
    db.commit()
    db.refresh(ab)
    return ab, True


def run_import(
    db: Session,
    entreprise_id: int,
    rows: List[Dict[str, str]],
    format_cfg: Dict,
    confirmed_accounts: Optional[Dict[str, Dict]] = None,
    confirmed_abos: Optional[List[Dict[str, Any]]] = None,
    confirmed_conflicts: Optional[List[Dict[str, Any]]] = None,
    analyze_abos: Optional[Dict[str, Any]] = None,
    dry_run: bool = False,
    upload_id: Optional[str] = None,
    rows_data: Optional[List[Dict]] = None,
) -> Dict:
    rows_data = rows_data or extract_rows_data(rows, format_cfg)
    factures_agregees = aggregate_factures_data(rows_data)
    date_values = [datetime.fromisoformat(l["date"]).date() for l in rows_data if l.get("date")]
    date_min = min(date_values).isoformat() if date_values else None
    date_max = max(date_values).isoformat() if date_values else None

    analyze_types = None
    if analyze_abos and analyze_abos.get("enabled"):
        analyze_types = analyze_abos.get("types") or []
        if not isinstance(analyze_types, list):
            analyze_types = []

    # Collecte des libelles d'abonnements (>0) par acces/facture pour proposer des noms
    abo_label_map: Dict[str, set] = {}
    if analyze_types is not None:
        for l in rows_data:
            type_code = l.get("typeCode")
            numero_acces = l.get("numeroAcces")
            if not numero_acces or str(numero_acces).strip() == "":
                continue
            if analyze_types and type_code not in analyze_types:
                continue
            if categorize_montant(l) != "abo":
                continue
            if l.get("montantHT", 0) <= 0:
                continue
            key = f"{l['numeroCompte']}|{numero_acces}|{l['numeroFacture']}|{l['date']}"
            abo_label_map.setdefault(key, set()).add((l.get("libelleDetail") or "").strip())

    comptes_existants = db.query(Compte).filter(Compte.entreprise_id == entreprise_id).all()
    comptes_map = {c.num: c for c in comptes_existants}
    comptes_uniques = {f["numeroCompte"] for f in factures_agregees}
    comptes_a_creer = [num for num in comptes_uniques if num not in comptes_map]

    factures_prevues = len(factures_agregees)
    lignes_prevues = len(rows_data)
    lignes_factures_prevues = sum(len(f.get("lignes", [])) for f in factures_agregees)

    suggestions_abos: List[Dict[str, Any]] = []
    existing_abos = db.query(Abonnement).filter(Abonnement.entreprise_id == entreprise_id).all()
    if analyze_types is not None:
        existing_name_price = {(ab.nom.strip().lower(), round(float(ab.prix), 2)) for ab in existing_abos}
        aggregated: Dict[Tuple[str, float], Dict[str, Any]] = {}
        # Parcourt les lignes agregees (par numeroAcces) pour calculer les nets et proposer des abos
        for facture in factures_agregees:
            for line in facture["lignes"]:
                numero_acces = line.get("numeroAcces")
                if not numero_acces or str(numero_acces).strip() == "":
                    continue
                if analyze_types and line.get("type") not in analyze_types:
                    continue
                net_val = round(float(line.get("abo", 0.0) + line.get("remises", 0.0)), 2)
                if net_val <= 0:
                    continue
                key_label = f"{facture['numeroCompte']}|{numero_acces}|{facture['numeroFacture']}|{facture['date']}"
                labels = abo_label_map.get(key_label, set())
                name = ", ".join(sorted([lab for lab in labels if lab])) or f"Abo {net_val:.2f}"
                if (name.strip().lower(), net_val) in existing_name_price:
                    continue
                key_pair = (name.lower(), net_val)
                entry = aggregated.setdefault(
                    key_pair,
                    {
                        "nom": name,
                        "prix": net_val,
                        "typeCode": line.get("type"),
                        "count_lignes": 0,
                        "numeroAcces_set": set(),
                        "numeroCompte": facture.get("numeroCompte"),
                        "numeroAcces_list": [],
                        "numeroFacture": facture.get("numeroFacture"),
                        "date": facture.get("date"),
                    },
                )
                entry["numeroAcces_set"].add(numero_acces)
        for _, val in aggregated.items():
            acc_set = val.get("numeroAcces_set", set())
            val["count_lignes"] = len(acc_set)
            val["numeroAcces_list"] = sorted(list(acc_set))
            val.pop("numeroAcces_set", None)
            if val["count_lignes"] > 0:
                suggestions_abos.append(val)

    # Cache factures existantes (sur comptes deja existants), utilise aussi pour detecter les conflits en dry-run
    factures_existantes: List[Facture] = []
    if comptes_map:
        factures_existantes = db.query(Facture).filter(Facture.compte_id.in_([c.id for c in comptes_map.values()])).all()
    factures_set = {f"{f.num}|{f.compte_id}|{f.date}": f for f in factures_existantes}

    lignes_factures_by_facture: Dict[int, List[Dict[str, Any]]] = {}
    if factures_existantes:
        facture_ids = [f.id for f in factures_existantes]
        rows_lf = (
            db.query(LigneFacture, Ligne)
            .join(Ligne, LigneFacture.ligne_id == Ligne.id)
            .filter(LigneFacture.facture_id.in_(facture_ids))
            .all()
        )
        for lf, ligne in rows_lf:
            lignes_factures_by_facture.setdefault(lf.facture_id, []).append({"lf": lf, "ligne": ligne})

    conflits: List[Dict[str, Any]] = []
    conflict_facture_ids: set[int] = set()
    for facture_data in factures_agregees:
        compte = comptes_map.get(facture_data["numeroCompte"])
        if not compte:
            continue
        facture_key = f"{facture_data['numeroFacture']}|{compte.id}|{facture_data['date']}"
        facture_existante = factures_set.get(facture_key)
        if not facture_existante:
            continue

        ancien_facture = _amounts_from_obj(facture_existante)
        nouveau_facture = _amounts_from_dict(facture_data)
        delta_facture = _compute_delta(ancien_facture, nouveau_facture)
        if not _has_conflict(delta_facture):
            continue

        csv_lignes_par_numero: Dict[str, Dict[str, Any]] = {}
        for ligne_data in facture_data.get("lignes", []):
            numero_acces = str((ligne_data or {}).get("numeroAcces") or "").strip()
            if numero_acces:
                csv_lignes_par_numero[numero_acces] = ligne_data

        lignes_conflit: List[Dict[str, Any]] = []
        for item in lignes_factures_by_facture.get(facture_existante.id, []):
            lf: LigneFacture = item["lf"]
            ligne: Ligne = item["ligne"]
            numero_ligne = str(ligne.num or "").strip()
            csv_ligne = csv_lignes_par_numero.get(numero_ligne)

            ancien_ligne = _amounts_from_obj(lf)
            nouveau_ligne = _amounts_from_dict(csv_ligne) if csv_ligne else dict(ancien_ligne)
            delta_ligne = _compute_delta(ancien_ligne, nouveau_ligne)

            lignes_conflit.append(
                {
                    "ligne_facture_id": lf.id,
                    "ligne_num": numero_ligne,
                    "ligne_nom": (ligne.nom or (csv_ligne or {}).get("nomLigne") or "").strip(),
                    "statut_actuel": int(lf.statut or 0),
                    "ancien": ancien_ligne,
                    "nouveau": nouveau_ligne,
                    "delta": delta_ligne,
                }
            )

        conflits.append(
            {
                "facture_id": facture_existante.id,
                "num": str(facture_existante.num),
                "compte_num": str(compte.num),
                "compte_nom": (compte.nom or "").strip(),
                "date": facture_existante.date.isoformat() if facture_existante.date else str(facture_data.get("date") or ""),
                "statut_actuel": int(facture_existante.statut or 0),
                "ancien": ancien_facture,
                "nouveau": nouveau_facture,
                "delta": delta_facture,
                "lignes": lignes_conflit,
            }
        )
        conflict_facture_ids.add(facture_existante.id)

    if comptes_a_creer and (not confirmed_accounts or not all(n in confirmed_accounts for n in comptes_a_creer)):
        return {
            "status": "requires_account_confirmation",
            "comptes_a_creer": [
                {"num": n, "nom": f"Compte {n}", "lot": "Non defini"} for n in comptes_a_creer
            ],
            "stats": {
                "lignes_csv": len(rows),
                "factures_agregees": factures_prevues,
                "lignes_prevues": lignes_prevues,
                "lignes_factures_prevues": lignes_factures_prevues,
            },
            "upload_id": upload_id,
            "date_min": date_min,
            "date_max": date_max,
            "abonnements_suggeres": suggestions_abos,
            "conflits": conflits,
        }

    if dry_run:
        return {
            "status": "dry_run",
            "comptes_a_creer": [{"num": n, "nom": f"Compte {n}", "lot": "Non defini"} for n in comptes_a_creer],
            "stats": {
                "lignes_csv": len(rows),
                "factures_agregees": factures_prevues,
                "lignes_prevues": lignes_prevues,
                "lignes_factures_prevues": lignes_factures_prevues,
            },
            "upload_id": upload_id,
            "date_min": date_min,
            "date_max": date_max,
            "abonnements_suggeres": suggestions_abos,
            "conflits": conflits,
        }

    stats = {
        "lignes_csv": len(rows),
        "lignes_prevues": lignes_prevues,
        "comptes_crees": 0,
        "lignes_creees": 0,
        "factures_creees": 0,
        "lignes_factures_creees": 0,
        "abonnements_crees": 0,
        "lignes_abonnements_creees": 0,
        "factures_doublons": 0,
        "factures_mises_a_jour": 0,
        "erreurs": 0,
        "factures_prevues": factures_prevues,
        "lignes_factures_prevues": lignes_factures_prevues,
    }
    errors: List[str] = []

    # Creation des comptes manquants
    for num in comptes_a_creer:
        try:
            meta = confirmed_accounts.get(num) if confirmed_accounts else {}
            compte = _get_or_create_compte(
                db,
                entreprise_id,
                num,
                (meta or {}).get("nom") or f"Compte {num}",
                (meta or {}).get("lot") or "Non defini",
            )
            comptes_map[num] = compte
            stats["comptes_crees"] += 1
        except Exception as exc:  # pragma: no cover - defensive
            errors.append(f"Compte {num}: {exc}")
            stats["erreurs"] += 1

    lignes_cache: Dict[Tuple[int, str], Ligne] = {}

    # Creation factures et lignes_factures
    for idx, facture_data in enumerate(factures_agregees):
        compte = comptes_map.get(facture_data["numeroCompte"])
        if not compte:
            errors.append(f"Compte {facture_data['numeroCompte']} introuvable")
            stats["erreurs"] += 1
            continue
        facture_key = f"{facture_data['numeroFacture']}|{compte.id}|{facture_data['date']}"
        if facture_key in factures_set:
            facture_existante = factures_set.get(facture_key)
            if facture_existante and facture_existante.id in conflict_facture_ids:
                continue
            stats["factures_doublons"] += 1
            continue
        try:
            facture = Facture(
                num=str(facture_data["numeroFacture"]),
                compte_id=compte.id,
                date=datetime.fromisoformat(facture_data["date"]).date(),
                abo=Decimal(str(round(facture_data["abo"], 2))),
                conso=Decimal(str(round(facture_data["conso"], 2))),
                remises=Decimal(str(round(facture_data["remises"], 2))),
                achat=Decimal(str(round(facture_data["achat"], 2))),
                statut=0,
                csv_id=upload_id,
            )
            db.add(facture)
            db.commit()
            db.refresh(facture)
            factures_set[facture_key] = facture
            stats["factures_creees"] += 1

            # lignes_factures
            for ligne_data in facture_data["lignes"]:
                try:
                    ligne = _get_or_create_ligne(
                        db,
                        compte.id,
                        ligne_data["numeroAcces"],
                        ligne_data["type"],
                        nom=ligne_data.get("nomLigne"),
                        sous_compte=ligne_data.get("sousCompte"),
                    )
                    lignes_cache[(compte.id, ligne_data["numeroAcces"])] = ligne
                    lf = LigneFacture(
                        facture_id=facture.id,
                        ligne_id=ligne.id,
                        abo=Decimal(str(round(ligne_data["abo"], 2))),
                        conso=Decimal(str(round(ligne_data["conso"], 2))),
                        remises=Decimal(str(round(ligne_data["remises"], 2))),
                        achat=Decimal(str(round(ligne_data["achat"], 2))),
                        statut=0,
                    )
                    db.add(lf)
                    db.commit()
                    stats["lignes_factures_creees"] += 1
                except Exception as exc:  # pragma: no cover - defensive
                    db.rollback()
                    errors.append(f"Ligne {ligne_data.get('numeroAcces')}: {exc}")
                    stats["erreurs"] += 1
        except Exception as exc:  # pragma: no cover - defensive
            db.rollback()
            errors.append(f"Facture {facture_data['numeroFacture']}: {exc}")
            stats["erreurs"] += 1

        if (idx + 1) % 50 == 0:
            logger.info(
                "Import factures progress %s/%s lignes_factures=%s/%s",
                idx + 1,
                factures_prevues,
                stats["lignes_factures_creees"],
                lignes_factures_prevues,
            )

    # Application des conflits confirms (mise a jour de factures existantes + lignes associees)
    if confirmed_conflicts is not None and not dry_run:
        try:
            for conflict in confirmed_conflicts:
                if not isinstance(conflict, dict):
                    continue
                if not conflict.get("accept"):
                    continue

                facture_id = conflict.get("facture_id")
                if facture_id is None:
                    continue
                try:
                    facture_id_int = int(facture_id)
                except Exception:
                    continue

                facture = db.query(Facture).filter(Facture.id == facture_id_int).first()
                if not facture:
                    continue

                nouveau_facture_payload = conflict.get("nouveau")
                nouveau_facture = (
                    _amounts_from_dict(nouveau_facture_payload)
                    if isinstance(nouveau_facture_payload, dict)
                    else _amounts_from_obj(facture)
                )
                facture.abo = Decimal(str(_as_amount(nouveau_facture["abo"])))
                facture.conso = Decimal(str(_as_amount(nouveau_facture["conso"])))
                facture.remises = Decimal(str(_as_amount(nouveau_facture["remises"])))
                facture.achat = Decimal(str(_as_amount(nouveau_facture["achat"])))

                reset_statut = bool(conflict.get("reset_statut"))
                if reset_statut:
                    facture.statut = 0
                db.add(facture)

                lignes_payload = conflict.get("lignes") or []
                lignes_payload_map: Dict[int, Dict[str, Any]] = {}
                for lc in lignes_payload:
                    if not isinstance(lc, dict):
                        continue
                    try:
                        lf_id = int(lc.get("ligne_facture_id"))
                    except Exception:
                        continue
                    lignes_payload_map[lf_id] = lc

                lignes_facture_db = db.query(LigneFacture).filter(LigneFacture.facture_id == facture.id).all()
                for lf in lignes_facture_db:
                    payload_ligne = lignes_payload_map.get(int(lf.id))
                    if payload_ligne:
                        nouveau_ligne_payload = payload_ligne.get("nouveau")
                        nouveau_ligne = (
                            _amounts_from_dict(nouveau_ligne_payload)
                            if isinstance(nouveau_ligne_payload, dict)
                            else _amounts_from_obj(lf)
                        )
                        lf.abo = Decimal(str(_as_amount(nouveau_ligne["abo"])))
                        lf.conso = Decimal(str(_as_amount(nouveau_ligne["conso"])))
                        lf.remises = Decimal(str(_as_amount(nouveau_ligne["remises"])))
                        lf.achat = Decimal(str(_as_amount(nouveau_ligne["achat"])))
                    if reset_statut:
                        lf.statut = 0
                    db.add(lf)

                stats["factures_mises_a_jour"] = stats.get("factures_mises_a_jour", 0) + 1
            db.commit()
        except Exception as exc:  # pragma: no cover - defensive
            db.rollback()
            errors.append(f"Mise a jour conflits: {exc}")
            stats["erreurs"] += 1

    # Creation abonnements selectionnes et liens lignes
    if confirmed_abos and not dry_run:
        for abo_sel in confirmed_abos:
            try:
                prix_raw = abo_sel.get("prix")
                try:
                    prix = round(float(prix_raw), 2)
                except Exception:
                    raise ValueError(f"Prix abonnement invalide: {prix_raw}")
                if prix <= 0:
                    raise ValueError(f"Prix abonnement nul ou negatif: {prix}")
                nom = (abo_sel.get("nom") or f"Abo {prix:.2f}").strip()
                ab_obj, created = _get_or_create_abonnement(db, nom, prix, entreprise_id)
                if created:
                    stats["abonnements_crees"] += 1
                for facture in factures_agregees:
                    compte = comptes_map.get(facture.get("numeroCompte"))
                    if not compte:
                        continue
                    for line in facture.get("lignes", []):
                        numero_acces = line.get("numeroAcces")
                        if not numero_acces or str(numero_acces).strip() == "":
                            continue
                        if analyze_types and line.get("type") not in analyze_types:
                            continue
                        net_val = round(float(line.get("abo", 0.0) + line.get("remises", 0.0)), 2)
                        if net_val != prix:
                            continue
                        ligne = lignes_cache.get((compte.id, numero_acces))
                        if not ligne:
                            ligne = db.query(Ligne).filter(Ligne.compte_id == compte.id, Ligne.num == numero_acces).first()
                            if ligne:
                                lignes_cache[(compte.id, numero_acces)] = ligne
                        if not ligne:
                            continue
                        date_val = None
                        try:
                            if facture.get("date"):
                                date_val = datetime.fromisoformat(facture["date"]).date()
                        except Exception:
                            date_val = None
                        link_exists = (
                            db.query(LigneAbonnement)
                            .filter(LigneAbonnement.ligne_id == ligne.id, LigneAbonnement.abonnement_id == ab_obj.id)
                            .first()
                        )
                        if not link_exists:
                            la = LigneAbonnement(ligne_id=ligne.id, abonnement_id=ab_obj.id, date=date_val)
                            db.add(la)
                            db.commit()
                            stats["lignes_abonnements_creees"] += 1
            except Exception as exc:  # pragma: no cover - defensive
                db.rollback()
                errors.append(f"Abonnement {abo_sel}: {exc}")
                stats["erreurs"] += 1

    status = "success" if stats["erreurs"] == 0 else "partial"
    return {
        "status": status,
        "stats": stats,
        "errors": errors,
        "upload_id": upload_id,
        "date_min": date_min,
        "date_max": date_max,
        "abonnements_suggeres": suggestions_abos,
        "conflits": conflits,
    }


def parse_csv_file(file_bytes: bytes) -> List[Dict[str, str]]:
    content = file_bytes.decode("utf-8-sig", errors="ignore")
    # Detect delimiter (common: ; or ,)
    delimiter = ","
    sample = content[:4096]
    try:
        sniffed = csv.Sniffer().sniff(sample, delimiters=";,")
        delimiter = sniffed.delimiter
    except Exception:
        if ";" in sample and "," not in sample:
            delimiter = ";"
    reader = csv.DictReader(io.StringIO(content), delimiter=delimiter)
    return list(reader)

