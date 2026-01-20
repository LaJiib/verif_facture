"""Backend-side auto-verification logic (isolated for future extensions)."""

from __future__ import annotations

import datetime
import logging
from typing import Dict, List, Optional, Tuple

from fastapi import HTTPException
from sqlalchemy.orm import Session

from ..models import Facture, LigneFacture, Ligne, LigneAbonnement, Abonnement
from .schemas import AutoVerifFullResult, AutoVerifAnomaly

logger = logging.getLogger("api_v2.autoverif")


def _prev_month_range(target: datetime.date) -> Tuple[datetime.date, datetime.date]:
    first_of_month = target.replace(day=1)
    prev_month_last_day = first_of_month - datetime.timedelta(days=1)
    prev_month_start = prev_month_last_day.replace(day=1)
    return prev_month_start, prev_month_last_day


def _get_prev_month_subscription_price(ligne_id: int, facture_date: datetime.date, db: Session) -> Optional[float]:
    start, end = _prev_month_range(facture_date)
    row = (
        db.query(LigneAbonnement, Abonnement)
        .join(Abonnement, LigneAbonnement.abonnement_id == Abonnement.id)
        .filter(
            LigneAbonnement.ligne_id == ligne_id,
            LigneAbonnement.date != None,  # noqa: E711
            LigneAbonnement.date >= start,
            LigneAbonnement.date <= end,
        )
        .order_by(LigneAbonnement.date.desc())
        .first()
    )
    if row:
        _, ab = row
        return float(ab.prix)
    return None


def _get_nearest_validated_facture(compte_id: int, target_date: datetime.date, db: Session, exclude_id: Optional[int] = None) -> Optional[Facture]:
    rows = (
        db.query(Facture)
        .filter(
            Facture.compte_id == compte_id,
            Facture.statut == 1,
            Facture.id != None,  # noqa: E711
            Facture.id != exclude_id if exclude_id is not None else True,
        )
        .all()
    )
    if not rows:
        return None
    best = None
    best_delta = None
    for f in rows:
        delta = abs((target_date - f.date).days)
        if best_delta is None or delta < best_delta:
            best_delta = delta
            best = f
    return best


def _get_nearest_validated_facture_ref(ligne_id: int, compte_id: int, facture_date: datetime.date, db: Session, exclude_id: Optional[int] = None) -> Optional[float]:
    """Recherche la facture validée la plus proche (avant ou après) contenant la ligne et retourne son net_abo."""
    nearest = _get_nearest_validated_facture(compte_id, facture_date, db, exclude_id=exclude_id)
    if not nearest:
        return None
    row = (
        db.query((LigneFacture.abo + LigneFacture.remises).label("net_abo"))
        .filter(LigneFacture.facture_id == nearest.id, LigneFacture.ligne_id == ligne_id)
        .first()
    )
    if row:
        return float(row.net_abo or 0)
    return None


def _status_priority(val: str) -> int:
    if val == "conteste":
        return 3
    if val == "a_verifier":
        return 2
    return 1  # valide


def compute_auto_verif_full(facture_id: int, db: Session) -> AutoVerifFullResult:
    facture: Optional[Facture] = db.query(Facture).filter(Facture.id == facture_id).first()
    if not facture:
        raise HTTPException(status_code=404, detail="Facture introuvable")

    lignes_rows = (
        db.query(
            LigneFacture.id.label("ligne_facture_id"),
            LigneFacture.ligne_id.label("ligne_id"),
            Ligne.num.label("ligne_num"),
            Ligne.type.label("ligne_type"),
            (LigneFacture.abo + LigneFacture.remises).label("net_abo"),
            LigneFacture.conso.label("conso"),
            LigneFacture.achat.label("achat"),
        )
        .join(Ligne, Ligne.id == LigneFacture.ligne_id)
        .filter(LigneFacture.facture_id == facture_id)
        .all()
    )
    if not lignes_rows:
        raise HTTPException(status_code=400, detail="Aucune ligne pour cette facture")

    lignes = [
        {
            "ligne_facture_id": row.ligne_facture_id,
            "ligne_id": row.ligne_id,
            "ligne_num": row.ligne_num,
            "ligne_type": row.ligne_type,
            "net_abo": float(row.net_abo or 0),
            "conso": float(row.conso or 0),
            "achat": float(row.achat or 0),
        }
        for row in lignes_rows
    ]

    # Totaux pour l'écart (facture - somme des lignes)
    total_lignes = sum(l["net_abo"] + l["conso"] + l["achat"] for l in lignes)
    total_facture = facture.total_ht
    ecart_val = round(total_facture - total_lignes, 2)
    ecart_statut = "valide" if abs(ecart_val) < 0.01 else "conteste"

    # Achats: validation auto si valeur nulle
    achat_statut = "valide" if abs(float(facture.achat or 0)) < 0.01 else "a_verifier"

    group_statuts: Dict[str, Dict[str, str]] = {}
    group_comments: Dict[str, Dict[str, Optional[str]]] = {}
    group_anomalies: Dict[str, List[AutoVerifAnomaly]] = {}

    # Références par ligne
    for line in lignes:
        group_key = f"{line['ligne_type']}|{line['net_abo']:.2f}"
        ref_price = _get_prev_month_subscription_price(line["ligne_id"], facture.date, db)
        ref_origin = "abonnement_prec"
        if ref_price is None:
            ref_price = _get_nearest_validated_facture_ref(line["ligne_id"], facture.compte_id, facture.date, db, exclude_id=facture.id)
            ref_origin = "facture_validee"

        if ref_price is not None:
            if abs(line["net_abo"] - ref_price) < 0.01:
                status = "valide"
                detail = f"Net {line['net_abo']:.2f} EUR conforme à la référence ({ref_price:.2f})"
            else:
                status = "conteste"
                detail = f"Net {line['net_abo']:.2f} EUR différent de la référence ({ref_price:.2f})"
                group_anomalies.setdefault(group_key, []).append(
                    AutoVerifAnomaly(kind="net_change", line=line["ligne_num"], detail=detail, prev_net=ref_price, curr_net=line["net_abo"])
                )
        else:
            status = "a_verifier"
            detail = "Aucune référence disponible (abonnement ou facture validée)"

        # Consolidation par groupe (pire statut l'emporte)
        prev = group_statuts.get(group_key, {"aboNet": "valide", "achat": achat_statut})
        # achat par défaut = statut global achat (mais si achat du groupe nul -> valide)
        group_achat_status = "valide" if abs(line["achat"]) < 0.01 else achat_statut
        # pour achat on garde le meilleur (valide si une ligne du groupe est à 0 après consolidation des totaux)
        if _status_priority(group_achat_status) < _status_priority(prev["achat"]):
            prev["achat"] = group_achat_status
        # pire statut aboNet l'emporte
        worse = status if _status_priority(status) > _status_priority(prev["aboNet"]) else prev["aboNet"]
        group_statuts[group_key] = {"aboNet": worse, "achat": prev["achat"]}

        # Commentaires
        group_comments.setdefault(group_key, {})
        existing_comment = group_comments[group_key].get("aboNet") or ""
        prefix = "[Réf abo préc]" if ref_origin == "abonnement_prec" else "[Réf facture validée]"
        comment_line = f"{prefix} {line['ligne_num']}: {detail}"
        group_comments[group_key]["aboNet"] = (existing_comment + "\n" + comment_line).strip()

    # Ajuste achat statut à partir des totaux par groupe
    for key, lines_in_group in _group_lines_by_key(lignes).items():
        total_achat = sum(l["achat"] for l in lines_in_group)
        if abs(total_achat) < 0.01:
            group_statuts[key]["achat"] = "valide"

    # Statut global aboNet agrégé
    global_abo_status = "valide"
    for g in group_statuts.values():
        if g["aboNet"] == "conteste":
            global_abo_status = "conteste"
            break
        if g["aboNet"] == "a_verifier" and global_abo_status != "conteste":
            global_abo_status = "a_verifier"

    metric_statuts = {
        "aboNet": global_abo_status,
        "ecart": ecart_statut,
        "achat": achat_statut,
        "conso": "a_verifier",
    }
    metric_comments = {
        "ecart": "OK" if ecart_statut == "valide" else f"Écart facture - lignes: {ecart_val:+.2f} €",
    }
    metric_reals = {"ecart": f"{ecart_val:.2f}"}

    # Comparatif avec la facture validée la plus proche (avant/après) pour remonter les variations
    previous_facture = _get_nearest_validated_facture(facture.compte_id, facture.date, db, exclude_id=facture.id)
    summary = {"added": 0, "removed": 0, "modified": 0, "previousFactureId": None, "previousFactureNum": None}
    if previous_facture:
        summary["previousFactureId"] = previous_facture.id
        summary["previousFactureNum"] = previous_facture.num
        prev_lines_rows = (
            db.query(
                LigneFacture.ligne_id.label("ligne_id"),
                Ligne.num.label("ligne_num"),
                (LigneFacture.abo + LigneFacture.remises).label("net_abo"),
                LigneFacture.achat.label("achat"),
            )
            .join(Ligne, Ligne.id == LigneFacture.ligne_id)
            .filter(LigneFacture.facture_id == previous_facture.id)
            .all()
        )
        prev_map = {row.ligne_id: row for row in prev_lines_rows}
        seen_prev = set()
        for line in lignes:
            prev = prev_map.get(line["ligne_id"])
            group_key = f"{line['ligne_type']}|{line['net_abo']:.2f}"
            if prev is None:
                summary["added"] += 1
                group_anomalies.setdefault(group_key, []).append(
                    AutoVerifAnomaly(
                        kind="added",
                        line=line["ligne_num"],
                        detail=f"Ligne ajoutée: net {line['net_abo']:.2f} €",
                        curr_net=line["net_abo"],
                        curr_achat=line["achat"],
                    )
                )
                continue
            seen_prev.add(prev.ligne_id)
            prev_net = float(prev.net_abo or 0)
            if abs(prev_net - line["net_abo"]) > 0.01:
                summary["modified"] += 1
                group_anomalies.setdefault(group_key, []).append(
                    AutoVerifAnomaly(
                        kind="net_change",
                        line=line["ligne_num"],
                        detail=f"Net changé {prev_net:.2f} € -> {line['net_abo']:.2f} €",
                        prev_net=prev_net,
                        curr_net=line["net_abo"],
                        prev_achat=float(prev.achat or 0),
                        curr_achat=line["achat"],
                )
            )
        for prev in prev_lines_rows:
            if prev.ligne_id in seen_prev:
                continue
            key = f"removed|{prev.net_abo:.2f}"
            summary["removed"] += 1
            group_anomalies.setdefault(key, []).append(
                AutoVerifAnomaly(
                    kind="removed",
                    line=prev.ligne_num,
                    detail=f"Ligne supprimée: net {float(prev.net_abo or 0):.2f} €",
                    prev_net=float(prev.net_abo or 0),
                    prev_achat=float(prev.achat or 0),
                )
            )
    else:
        # Aucune facture validée trouvée : toutes les lignes sont considérées comme nouvelles
        for line in lignes:
            summary["added"] += 1
            group_key = f"{line['ligne_type']}|{line['net_abo']:.2f}"
            group_anomalies.setdefault(group_key, []).append(
                AutoVerifAnomaly(
                    kind="added",
                    line=line["ligne_num"],
                    detail=f"Ligne ajoutée: net {line['net_abo']:.2f} €",
                    curr_net=line["net_abo"],
                    curr_achat=line["achat"],
                )
            )

    return AutoVerifFullResult(
        metricStatuts=metric_statuts,
        metricComments=metric_comments,
        metricReals=metric_reals,
        groupStatuts=group_statuts,
        groupComments=group_comments,
        groupAnomalies=group_anomalies,
        summary=summary,
        previousFactureNum=summary.get("previousFactureNum"),
    )


def _group_lines_by_key(lignes: List[dict]) -> Dict[str, List[dict]]:
    grouped: Dict[str, List[dict]] = {}
    for line in lignes:
        key = f"{line['ligne_type']}|{line['net_abo']:.2f}"
        grouped.setdefault(key, []).append(line)
    return grouped
