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


def _get_active_subscription_price(ligne_id: int, db: Session) -> Optional[Tuple[float, str]]:
    row = (
        db.query(Abonnement.prix, Abonnement.nom)
        .join(LigneAbonnement, LigneAbonnement.abonnement_id == Abonnement.id)
        .filter(LigneAbonnement.ligne_id == ligne_id)
        .order_by(LigneAbonnement.date.desc().nullslast())
        .first()
    )
    if row:
        return float(row.prix), str(row.nom or "")
    return None


def _get_latest_abonnement_by_ligne(ligne_ids: List[int], db: Session) -> Dict[int, dict]:
    if not ligne_ids:
        return {}
    rows = (
        db.query(LigneAbonnement, Abonnement)
        .join(Abonnement, LigneAbonnement.abonnement_id == Abonnement.id)
        .filter(LigneAbonnement.ligne_id.in_(ligne_ids))
        .order_by(LigneAbonnement.date.desc().nullslast())
        .all()
    )
    out: Dict[int, dict] = {}
    for la, ab in rows:
        if la.ligne_id in out:
            continue
        out[la.ligne_id] = {
            "id": int(ab.id),
            "nom": str(ab.nom or ""),
            "prix": float(ab.prix or 0),
        }
    return out


def _build_group_key(ligne_type: int, net_abo: float, abo_id_ref: Optional[int] = None) -> str:
    if abo_id_ref:
        return f"abo|{int(abo_id_ref)}|{int(ligne_type)}|{float(net_abo):.2f}"
    return f"price|{int(ligne_type)}|{float(net_abo):.2f}"


def _get_nearest_validated_facture(
    compte_id: int,
    target_date: datetime.date,
    db: Session,
    exclude_id: Optional[int] = None,
) -> Optional[Facture]:
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


def _get_nearest_validated_facture_ref(
    ligne_id: int,
    compte_id: int,
    facture_date: datetime.date,
    db: Session,
    exclude_id: Optional[int] = None,
) -> Optional[float]:
    """Find nearest validated invoice (before/after) and return net_abo for this line."""
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
    return 1


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
        ecart_val = round(float(facture.total_ht or 0), 2)
        ecart_statut = "valide" if abs(ecart_val) < 0.01 else "conteste"
        metric_comment = (
            "Aucune ligne importee"
            if abs(ecart_val) < 0.01
            else f"Aucune ligne importee - ecart = total facture ({ecart_val:+.2f} EUR)"
        )
        return AutoVerifFullResult(
            metricStatuts={"ecart": ecart_statut, "achat": "valide", "aboNet": "a_verifier", "conso": "a_verifier"},
            metricComments={"ecart": metric_comment},
            metricReals={"ecart": f"{ecart_val:.2f}"},
            groupStatuts={},
            groupComments={},
            groupAnomalies={},
            groups=[],
            summary={"added": 0, "removed": 0, "modified": 0, "previousFactureId": None, "previousFactureNum": None},
            previousFactureNum=None,
            lineStatuts={},
        )

    lignes = [
        {
            "ligne_facture_id": int(row.ligne_facture_id),
            "ligne_id": int(row.ligne_id),
            "ligne_num": row.ligne_num,
            "ligne_type": int(row.ligne_type),
            "net_abo": float(row.net_abo or 0),
            "conso": float(row.conso or 0),
            "achat": float(row.achat or 0),
            "abo_id_ref": None,
        }
        for row in lignes_rows
    ]

    abo_ref_map = _get_latest_abonnement_by_ligne([int(l["ligne_id"]) for l in lignes], db)
    for line in lignes:
        abo_ref = abo_ref_map.get(int(line["ligne_id"]))
        if abo_ref:
            line["abo_id_ref"] = int(abo_ref["id"])

    total_lignes = sum(l["net_abo"] + l["conso"] + l["achat"] for l in lignes)
    total_facture = float(facture.total_ht or 0)
    ecart_val = round(total_facture - total_lignes, 2)
    ecart_statut = "valide" if abs(ecart_val) < 0.01 else "conteste"

    achat_statut = "valide" if abs(float(facture.achat or 0)) < 0.01 else "a_verifier"

    group_statuts: Dict[str, Dict[str, str]] = {}
    group_comments: Dict[str, Dict[str, Optional[str]]] = {}
    group_anomalies: Dict[str, List[AutoVerifAnomaly]] = {}
    group_line_ids: Dict[str, List[int]] = {}
    comment_entries: Dict[str, List[tuple]] = {}
    line_statuts: Dict[int, dict] = {}

    for line in lignes:
        group_key = _build_group_key(
            ligne_type=int(line["ligne_type"]),
            net_abo=float(line["net_abo"]),
            abo_id_ref=int(line["abo_id_ref"]) if line.get("abo_id_ref") else None,
        )

        abo_ref = abo_ref_map.get(int(line["ligne_id"]))
        ref_nom = None
        if abo_ref is not None:
            ref_price = float(abo_ref["prix"])
            ref_nom = str(abo_ref["nom"] or "")
            ref_origin = "abonnement_contractuel"
        else:
            ref_price = _get_nearest_validated_facture_ref(
                line["ligne_id"],
                facture.compte_id,
                facture.date,
                db,
                exclude_id=facture.id,
            )
            ref_origin = "facture_validee"

        if ref_price is not None:
            if abs(float(line["net_abo"]) - ref_price) < 0.01:
                status = "valide"
                detail = f"Net {line['net_abo']:.2f} EUR conforme a la reference ({ref_price:.2f})"
            else:
                status = "conteste"
                detail = f"Net {line['net_abo']:.2f} EUR different de la reference ({ref_price:.2f})"
                group_anomalies.setdefault(group_key, []).append(
                    AutoVerifAnomaly(
                        kind="net_change",
                        line=line["ligne_num"],
                        detail=detail,
                        prev_net=ref_price,
                        curr_net=float(line["net_abo"]),
                    )
                )
        else:
            status = "a_verifier"
            detail = "Aucune reference disponible (abonnement ou facture validee)"

        prefix = f"[Abo: {ref_nom}]" if ref_origin == "abonnement_contractuel" and ref_nom else (
            "[Abo contractuel]" if ref_origin == "abonnement_contractuel" else "[Mois precedents]"
        )

        line_statuts[int(line["ligne_facture_id"])] = {
            "aboNet": status,
            "achat": "valide" if abs(float(line["achat"])) < 0.01 else "a_verifier",
            "comment": f"{detail} {prefix}",
        }

        prev = group_statuts.get(group_key, {"aboNet": "valide", "achat": achat_statut})
        group_achat_status = "valide" if abs(float(line["achat"])) < 0.01 else achat_statut
        if _status_priority(group_achat_status) < _status_priority(prev["achat"]):
            prev["achat"] = group_achat_status
        worse = status if _status_priority(status) > _status_priority(prev["aboNet"]) else prev["aboNet"]
        group_statuts[group_key] = {"aboNet": worse, "achat": prev["achat"]}

        group_line_ids.setdefault(group_key, []).append(int(line["ligne_facture_id"]))
        group_comments.setdefault(group_key, {})
        comment_entries.setdefault(group_key, []).append((prefix, detail, line["ligne_num"]))

    comment_threshold = 5
    for group_key, entries in comment_entries.items():
        counts: Dict[tuple, list] = {}
        for prefix, detail, ligne_num in entries:
            key_pd = (prefix, detail)
            counts.setdefault(key_pd, []).append(ligne_num)

        lines_out: List[str] = []
        for (prefix, detail), ligne_nums in counts.items():
            if len(ligne_nums) > comment_threshold:
                lines_out.append(f"{len(ligne_nums)} lignes: {detail} {prefix}")
            else:
                for num in ligne_nums:
                    lines_out.append(f"{num}: {detail} {prefix}")

        group_comments.setdefault(group_key, {})
        group_comments[group_key]["aboNet"] = "\n".join(lines_out)

    for key, lines_in_group in _group_lines_by_key(lignes).items():
        total_achat = sum(float(l["achat"]) for l in lines_in_group)
        if abs(total_achat) < 0.01 and key in group_statuts:
            group_statuts[key]["achat"] = "valide"

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
        "ecart": "OK" if ecart_statut == "valide" else f"Ecart facture - lignes: {ecart_val:+.2f} EUR",
    }
    metric_reals = {"ecart": f"{ecart_val:.2f}"}

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
            group_key = _build_group_key(
                ligne_type=int(line["ligne_type"]),
                net_abo=float(line["net_abo"]),
                abo_id_ref=int(line["abo_id_ref"]) if line.get("abo_id_ref") else None,
            )
            if prev is None:
                summary["added"] += 1
                group_anomalies.setdefault(group_key, []).append(
                    AutoVerifAnomaly(
                        kind="added",
                        line=line["ligne_num"],
                        detail=f"Ligne ajoutee: net {line['net_abo']:.2f} EUR",
                        curr_net=float(line["net_abo"]),
                        curr_achat=float(line["achat"]),
                    )
                )
                continue

            seen_prev.add(prev.ligne_id)
            prev_net = float(prev.net_abo or 0)
            if abs(prev_net - float(line["net_abo"])) > 0.01:
                summary["modified"] += 1
                group_anomalies.setdefault(group_key, []).append(
                    AutoVerifAnomaly(
                        kind="net_change",
                        line=line["ligne_num"],
                        detail=f"Net change {prev_net:.2f} EUR -> {line['net_abo']:.2f} EUR",
                        prev_net=prev_net,
                        curr_net=float(line["net_abo"]),
                        prev_achat=float(prev.achat or 0),
                        curr_achat=float(line["achat"]),
                    )
                )

        for prev in prev_lines_rows:
            if prev.ligne_id in seen_prev:
                continue
            key = f"removed|{float(prev.net_abo or 0):.2f}"
            summary["removed"] += 1
            group_anomalies.setdefault(key, []).append(
                AutoVerifAnomaly(
                    kind="removed",
                    line=prev.ligne_num,
                    detail=f"Ligne supprimee: net {float(prev.net_abo or 0):.2f} EUR",
                    prev_net=float(prev.net_abo or 0),
                    prev_achat=float(prev.achat or 0),
                )
            )
    else:
        for line in lignes:
            summary["added"] += 1
            group_key = _build_group_key(
                ligne_type=int(line["ligne_type"]),
                net_abo=float(line["net_abo"]),
                abo_id_ref=int(line["abo_id_ref"]) if line.get("abo_id_ref") else None,
            )
            group_anomalies.setdefault(group_key, []).append(
                AutoVerifAnomaly(
                    kind="added",
                    line=line["ligne_num"],
                    detail=f"Ligne ajoutee: net {line['net_abo']:.2f} EUR",
                    curr_net=float(line["net_abo"]),
                    curr_achat=float(line["achat"]),
                )
            )

    groups = [
        {
            "groupKey": key,
            "ligneFactureIds": group_line_ids.get(key, []),
            "statut": group_statuts.get(key, {"aboNet": "a_verifier", "achat": "a_verifier"}),
            "comments": group_comments.get(key, {}),
            "anomalies": group_anomalies.get(key, []),
        }
        for key in group_statuts.keys()
    ]

    return AutoVerifFullResult(
        metricStatuts=metric_statuts,
        metricComments=metric_comments,
        metricReals=metric_reals,
        groupStatuts=group_statuts,
        groupComments=group_comments,
        groupAnomalies=group_anomalies,
        groups=groups,
        summary=summary,
        previousFactureNum=summary.get("previousFactureNum"),
        lineStatuts={int(k): v for k, v in line_statuts.items()},
    )


def _group_lines_by_key(lignes: List[dict]) -> Dict[str, List[dict]]:
    grouped: Dict[str, List[dict]] = {}
    for line in lignes:
        key = _build_group_key(
            ligne_type=int(line["ligne_type"]),
            net_abo=float(line["net_abo"]),
            abo_id_ref=int(line["abo_id_ref"]) if line.get("abo_id_ref") else None,
        )
        grouped.setdefault(key, []).append(line)
    return grouped
