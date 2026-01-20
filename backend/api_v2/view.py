"""Aggregated read views."""

from __future__ import annotations

from collections import defaultdict
import logging
from datetime import datetime
from typing import Dict, List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import (
    Entreprise,
    Compte,
    Ligne,
    Facture,
    LigneFacture,
    Abonnement,
    LigneAbonnement,
)
from ..storage import list_uploads
from .schemas import (
    DashboardResponse,
    DashboardMonth,
    DashboardStats,
    MatriceResponse,
    LotMatrice,
    CompteMatrice,
    MatriceFactureItem,
    FactureDetail,
    FactureDetailLine,
    FactureOut,
    CompteOut,
    FactureDetailStats,
)

router = APIRouter(prefix="/v2/view", tags=["view"])
logger = logging.getLogger("api_v2.view")


def _get_entreprise_or_404(entreprise_id: int, db: Session) -> Entreprise:
    ent = db.query(Entreprise).filter(Entreprise.id == entreprise_id).first()
    if not ent:
        raise HTTPException(status_code=404, detail="Entreprise introuvable")
    return ent


@router.get("/entreprises/{entreprise_id}/dashboard", response_model=DashboardResponse)
def entreprise_dashboard(entreprise_id: int, db: Session = Depends(get_db)):
    ent = _get_entreprise_or_404(entreprise_id, db)

    nb_comptes = db.query(func.count(Compte.id)).filter(Compte.entreprise_id == entreprise_id).scalar() or 0
    nb_lignes = (
        db.query(func.count(Ligne.id))
        .join(Compte, Ligne.compte_id == Compte.id)
        .filter(Compte.entreprise_id == entreprise_id)
        .scalar()
        or 0
    )
    nb_factures = (
        db.query(func.count(Facture.id))
        .join(Compte, Facture.compte_id == Compte.id)
        .filter(Compte.entreprise_id == entreprise_id)
        .scalar()
        or 0
    )

    # Lignes par type
    lignes_par_type = (
        db.query(Ligne.type, func.count(Ligne.id))
        .join(Compte, Ligne.compte_id == Compte.id)
        .filter(Compte.entreprise_id == entreprise_id)
        .group_by(Ligne.type)
        .all()
    )

    # Statuts globaux
    statuts_global = defaultdict(int)
    for statut, count in (
        db.query(Facture.statut, func.count(Facture.id))
        .join(Compte, Facture.compte_id == Compte.id)
        .filter(Compte.entreprise_id == entreprise_id)
        .group_by(Facture.statut)
        .all()
    ):
        statuts_global[int(statut)] = count

    # Totaux par mois
    months_rows = (
        db.query(
            func.strftime("%Y-%m", Facture.date).label("mois"),
            func.count(Facture.id),
            func.sum(Facture.abo + Facture.conso + Facture.remises + Facture.achat).label("total_ht"),
            func.sum(Facture.abo).label("abo"),
            func.sum(Facture.conso).label("conso"),
            func.sum(Facture.remises).label("remises"),
            func.sum(Facture.achat).label("achat"),
        )
        .join(Compte, Facture.compte_id == Compte.id)
        .filter(Compte.entreprise_id == entreprise_id)
        .group_by("mois")
        .order_by("mois")
        .all()
    )

    months: List[DashboardMonth] = []
    for mois, count, total_ht, abo, conso, remises, achat in months_rows:
        statuts = defaultdict(int)
        for statut, s_count in (
            db.query(Facture.statut, func.count(Facture.id))
            .join(Compte, Facture.compte_id == Compte.id)
            .filter(Compte.entreprise_id == entreprise_id, func.strftime("%Y-%m", Facture.date) == mois)
            .group_by(Facture.statut)
            .all()
        ):
            statuts[int(statut)] = s_count
        months.append(
            DashboardMonth(
                mois=mois,
                total_ht=float(total_ht or 0),
                nb_factures=count or 0,
                statuts=statuts,
                categories={
                    "abo": float(abo or 0),
                    "conso": float(conso or 0),
                    "remises": float(remises or 0),
                    "achat": float(achat or 0),
                },
            )
        )

    last_month = months[-1] if months else None
    prev_month = months[-2] if len(months) >= 2 else None

    if last_month and prev_month:
        try:
            delta = (last_month.total_ht - prev_month.total_ht) / prev_month.total_ht if prev_month.total_ht else None
        except ZeroDivisionError:
            delta = None
        last_month.delta_pct = delta
        last_month.trend = (
            "up" if delta and delta > 0.01 else "down" if delta and delta < -0.01 else "flat"
        )
        cat_delta: Dict[str, float] = {}
        for key in ["abo", "conso", "remises", "achat"]:
            prev_val = prev_month.categories.get(key, 0) if prev_month.categories else 0
            cur_val = last_month.categories.get(key, 0) if last_month.categories else 0
            if prev_val:
                cat_delta[key] = (cur_val - prev_val) / prev_val
            else:
                cat_delta[key] = None
        last_month.categories_delta = cat_delta

    response = DashboardResponse(
        entreprise=ent,
        stats=DashboardStats(nb_comptes=nb_comptes, nb_lignes=nb_lignes, nb_factures=nb_factures),
        lignes_par_type=[{"type": int(t), "count": c} for t, c in lignes_par_type],
        statuts_global=statuts_global,
        months=months,
        last_month=last_month,
        prev_month=prev_month,
    )
    logger.info("Dashboard entreprise_id=%s mois=%s", entreprise_id, len(months))
    return response


@router.get("/entreprises/{entreprise_id}/matrice", response_model=MatriceResponse)
def entreprise_matrice(entreprise_id: int, db: Session = Depends(get_db)):
    ent = _get_entreprise_or_404(entreprise_id, db)
    factures = (
        db.query(Facture, Compte)
        .join(Compte, Facture.compte_id == Compte.id)
        .filter(Compte.entreprise_id == entreprise_id)
        .order_by(Compte.lot, Compte.num, Facture.date)
        .all()
    )

    months_set = set()
    lots: Dict[str, Dict[int, CompteMatrice]] = defaultdict(dict)
    lot_totals: Dict[str, Dict[str, float]] = defaultdict(lambda: defaultdict(float))
    lot_status: Dict[str, Dict[str, Dict[int, int]]] = defaultdict(lambda: defaultdict(lambda: defaultdict(int)))

    for f, c in factures:
        date_key = f.date.strftime("%Y-%m")
        months_set.add(date_key)
        lot_key = c.lot or "Sans lot"
        compte_entry = lots[lot_key].get(c.id)
        facture_item = MatriceFactureItem(
            facture_id=f.id,
            facture_num=f.num,
            statut=f.statut,
            date_key=date_key,
            abo=float(f.abo),
            conso=float(f.conso),
            remises=float(f.remises),
            achat=float(f.achat),
            total_ht=f.total_ht,
            csv_id=f.csv_id,
        )
        if not compte_entry:
            compte_entry = CompteMatrice(
                compte_id=c.id,
                compte_num=c.num,
                compte_nom=c.nom,
                lot=lot_key,
                factures=[facture_item],
            )
            lots[lot_key][c.id] = compte_entry
        else:
            compte_entry.factures.append(facture_item)

        lot_totals[lot_key][date_key] += f.total_ht
        lot_status[lot_key][date_key][int(f.statut)] += 1

    lot_list: List[LotMatrice] = []
    for lot, comptes_map in lots.items():
        comptes_sorted = sorted(comptes_map.values(), key=lambda x: x.compte_num)
        lot_list.append(
            LotMatrice(
                lot=lot,
                comptes=comptes_sorted,
                totals_by_month={k: float(v) for k, v in lot_totals[lot].items()},
                statuts_by_month={k: {int(st): int(cnt) for st, cnt in v.items()} for k, v in lot_status[lot].items()},
            )
        )

    months = sorted(months_set)
    response = MatriceResponse(entreprise=ent, months=months, lots=sorted(lot_list, key=lambda x: x.lot))
    logger.info("Matrice entreprise_id=%s lots=%s months=%s", entreprise_id, len(lot_list), len(months))
    return response


@router.get("/factures/{facture_id}/detail", response_model=FactureDetail)
def facture_detail(facture_id: int, db: Session = Depends(get_db)):
    facture = db.query(Facture).filter(Facture.id == facture_id).first()
    if not facture:
        raise HTTPException(status_code=404, detail="Facture introuvable")
    compte = db.query(Compte).filter(Compte.id == facture.compte_id).first()
    lignes = (
        db.query(LigneFacture, Ligne)
        .join(Ligne, LigneFacture.ligne_id == Ligne.id)
        .filter(LigneFacture.facture_id == facture_id)
        .all()
    )
    detail_lines = [
        FactureDetailLine(
            ligne_facture_id=lf.id,
            ligne_id=ligne.id,
            ligne_num=ligne.num,
            ligne_type=ligne.type,
            abo=float(lf.abo),
            conso=float(lf.conso),
            remises=float(lf.remises),
            achat=float(lf.achat),
            total_ht=lf.total_ht,
            statut=lf.statut,
        )
        for lf, ligne in lignes
    ]
    # Abonnements liés aux lignes de la facture
    abon_links = (
        db.query(LigneAbonnement, Abonnement, Ligne)
        .join(Ligne, LigneAbonnement.ligne_id == Ligne.id)
        .join(Abonnement, LigneAbonnement.abonnement_id == Abonnement.id)
        .filter(LigneAbonnement.ligne_id.in_([l.ligne_id for l in detail_lines]))
        .all()
    )
    abos = []
    for la, ab, l in abon_links:
        abos.append(
            {
                "ligne_id": l.id,
                "ligne_num": l.num,
                "abonnement": {"id": ab.id, "nom": ab.nom, "prix": float(ab.prix)},
                "date": la.date.isoformat() if la.date else None,
            }
        )

    facture_out = FactureOut(
        id=facture.id,
        numero_facture=facture.num,
        compte_id=facture.compte_id,
        date=facture.date,
        abo=float(facture.abo),
        conso=float(facture.conso),
        remises=float(facture.remises),
        achat=float(facture.achat),
        statut=facture.statut,
        csv_id=facture.csv_id,
        total_ht=facture.total_ht,
    )
    compte_out = CompteOut(
        id=compte.id,
        num=compte.num,
        nom=compte.nom,
        entreprise_id=compte.entreprise_id,
        lot=compte.lot,
    )
    logger.info("Detail facture id=%s lignes=%s", facture_id, len(detail_lines))
    return FactureDetail(facture=facture_out, compte=compte_out, lignes=detail_lines, abonnements=abos)


@router.get("/factures/{facture_id}/detail-stats", response_model=FactureDetailStats)
def facture_detail_stats(facture_id: int, db: Session = Depends(get_db)):
    """Vue complète pour le modal facture/compte (stats + détail lignes)."""
    base_detail = facture_detail(facture_id, db)
    facture = db.query(Facture).filter(Facture.id == facture_id).first()
    if not facture:
        raise HTTPException(status_code=404, detail="Facture introuvable")
    # Stats globales pour ce compte/mois
    stats_row = (
        db.query(
            func.sum(Facture.abo).label("total_abo"),
            func.sum(Facture.conso).label("total_conso"),
            func.sum(Facture.remises).label("total_remises"),
            func.sum(Facture.achat).label("total_achat"),
            func.sum(Facture.abo + Facture.conso + Facture.remises + Facture.achat).label("total_ht"),
        )
        .filter(Facture.id == facture_id)
        .first()
    )
    stats_globales = {
        "total_abo": float(stats_row.total_abo or 0),
        "total_conso": float(stats_row.total_conso or 0),
        "total_remises": float(stats_row.total_remises or 0),
        "total_achat": float(stats_row.total_achat or 0),
        "total_ht": float(stats_row.total_ht or 0),
    }
    # Stats globales précédentes sur le même compte (facture précédant la date actuelle)
    prev_row = (
        db.query(
            func.sum(Facture.abo).label("total_abo"),
            func.sum(Facture.conso).label("total_conso"),
            func.sum(Facture.remises).label("total_remises"),
            func.sum(Facture.achat).label("total_achat"),
            func.sum(Facture.abo + Facture.conso + Facture.remises + Facture.achat).label("total_ht"),
        )
        .filter(Facture.compte_id == facture.compte_id, Facture.date < facture.date)
        .order_by(Facture.date.desc())
        .first()
    )
    stats_prev = None
    if prev_row and any(prev_row):
        stats_prev = {
            "total_abo": float(prev_row.total_abo or 0),
            "total_conso": float(prev_row.total_conso or 0),
            "total_remises": float(prev_row.total_remises or 0),
            "total_achat": float(prev_row.total_achat or 0),
            "total_ht": float(prev_row.total_ht or 0),
        }
    # Aggregats par mois pour ce compte (limités)
    months_rows = (
        db.query(
            func.strftime("%Y-%m", Facture.date).label("mois"),
            func.sum(Facture.abo).label("abo"),
            func.sum(Facture.conso).label("conso"),
            func.sum(Facture.remises).label("remises"),
            func.sum(Facture.achat).label("achat"),
            func.sum(Facture.abo + Facture.conso + Facture.remises + Facture.achat).label("total_ht"),
            func.count(Facture.id).label("nb_factures"),
        )
        .filter(Facture.compte_id == facture.compte_id)
        .group_by("mois")
        .order_by("mois")
        .all()
    )
    months = []
    for row in months_rows:
        months.append(
            {
                "mois": row.mois,
                "total_ht": float(row.total_ht or 0),
                "nb_factures": int(row.nb_factures or 0),
                "abo": float(row.abo or 0),
                "conso": float(row.conso or 0),
                "remises": float(row.remises or 0),
                "achat": float(row.achat or 0),
            }
        )
    # Index des lignes (id -> valeur) pour comparaison
    lignes_map = {}
    for lf in base_detail.lignes:
        lignes_map[lf.ligne_id] = {
            "abo": lf.abo,
            "remises": lf.remises,
            "achat": lf.achat,
            "total_ht": lf.total_ht,
            "statut": lf.statut,
            "ligne_type": lf.ligne_type,
        }
    logger.info("Detail-stats facture id=%s lignes=%s months=%s", facture_id, len(base_detail.lignes), len(months))
    return FactureDetailStats(
        stats_globales=stats_globales,
        stats_globales_prev=stats_prev,
        months=months,
        lignes_by_id=lignes_map,
        facture_detail=base_detail,
    )


@router.get("/uploads/{entreprise_id}")
def uploads_for_entreprise(
    entreprise_id: int,
    category: str | None = None,
    limit: int | None = None,
    db: Session = Depends(get_db),
):
    ent = _get_entreprise_or_404(entreprise_id, db)
    uploads = list_uploads(ent.nom, category=category, limit=limit)
    logger.info("Uploads entreprise_id=%s count=%s", entreprise_id, len(uploads))
    return {"entreprise": {"id": ent.id, "nom": ent.nom}, "uploads": uploads}
