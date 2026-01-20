"""Read-only endpoints (no side effects)."""

from __future__ import annotations

from typing import List
import logging

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy.orm import Session
from sqlalchemy import text

from ..database import get_db
from ..models import (
    Entreprise,
    Compte,
    Ligne,
    Facture,
    LigneFacture,
    Abonnement,
    LigneAbonnement,
    FactureReport,
)
from .schemas import (
    EntrepriseOut,
    CompteOut,
    LigneOut,
    FactureOut,
    LigneFactureOut,
    AbonnementOut,
    FactureRapportOut,
)
from ..storage import load_upload_bytes, get_upload

logger = logging.getLogger("api_v2.read")

router = APIRouter(prefix="/v2/read", tags=["read"])


@router.get("/entreprises", response_model=List[EntrepriseOut])
def list_entreprises(db: Session = Depends(get_db)):
    return db.query(Entreprise).order_by(Entreprise.nom).all()


@router.get("/entreprises/{entreprise_id}", response_model=EntrepriseOut)
def get_entreprise(entreprise_id: int, db: Session = Depends(get_db)):
    ent = db.query(Entreprise).filter(Entreprise.id == entreprise_id).first()
    if not ent:
        raise HTTPException(status_code=404, detail="Entreprise introuvable")
    return ent


@router.get("/comptes", response_model=List[CompteOut])
def list_comptes(entreprise_id: int | None = None, db: Session = Depends(get_db)):
    q = db.query(Compte)
    if entreprise_id is not None:
        q = q.filter(Compte.entreprise_id == entreprise_id)
    return q.order_by(Compte.num).all()


@router.get("/comptes/{compte_id}", response_model=CompteOut)
def get_compte(compte_id: int, db: Session = Depends(get_db)):
    compte = db.query(Compte).filter(Compte.id == compte_id).first()
    if not compte:
        raise HTTPException(status_code=404, detail="Compte introuvable")
    return compte


@router.get("/lignes", response_model=List[LigneOut])
def list_lignes(compte_id: int | None = None, db: Session = Depends(get_db)):
    q = db.query(Ligne)
    if compte_id is not None:
        q = q.filter(Ligne.compte_id == compte_id)
    return q.order_by(Ligne.num).all()


@router.get("/lignes/{ligne_id}", response_model=LigneOut)
def get_ligne(ligne_id: int, db: Session = Depends(get_db)):
    ligne = db.query(Ligne).filter(Ligne.id == ligne_id).first()
    if not ligne:
        raise HTTPException(status_code=404, detail="Ligne introuvable")
    return ligne


@router.get("/factures", response_model=List[FactureOut])
def list_factures(
    entreprise_id: int | None = None,
    compte_id: int | None = None,
    date_debut: str | None = None,
    date_fin: str | None = None,
    db: Session = Depends(get_db),
):
    q = db.query(Facture)
    if compte_id is not None:
        q = q.filter(Facture.compte_id == compte_id)
    if entreprise_id is not None:
        q = q.join(Compte).filter(Compte.entreprise_id == entreprise_id)
    if date_debut:
        q = q.filter(Facture.date >= date_debut)
    if date_fin:
        q = q.filter(Facture.date <= date_fin)
    factures = q.order_by(Facture.date.desc()).all()
    logger.info("List factures count=%s entreprise_id=%s compte_id=%s", len(factures), entreprise_id, compte_id)
    return [
        FactureOut(
            id=f.id,
            numero_facture=f.num,
            compte_id=f.compte_id,
            date=f.date,
            abo=float(f.abo),
            conso=float(f.conso),
            remises=float(f.remises),
            achat=float(f.achat),
            statut=f.statut,
            csv_id=f.csv_id,
            total_ht=f.total_ht,
        )
        for f in factures
    ]


@router.get("/factures/{facture_id}", response_model=FactureOut)
def get_facture(facture_id: int, db: Session = Depends(get_db)):
    f = db.query(Facture).filter(Facture.id == facture_id).first()
    if not f:
        raise HTTPException(status_code=404, detail="Facture introuvable")
    return FactureOut(
        id=f.id,
        numero_facture=f.num,
        compte_id=f.compte_id,
        date=f.date,
        abo=float(f.abo),
        conso=float(f.conso),
        remises=float(f.remises),
        achat=float(f.achat),
        statut=f.statut,
        csv_id=f.csv_id,
        total_ht=f.total_ht,
    )


@router.get("/lignes-factures", response_model=List[LigneFactureOut])
def list_lignes_factures(
    facture_id: int | None = None,
    ligne_id: int | None = None,
    db: Session = Depends(get_db),
):
    q = db.query(LigneFacture)
    if facture_id is not None:
        q = q.filter(LigneFacture.facture_id == facture_id)
    if ligne_id is not None:
        q = q.filter(LigneFacture.ligne_id == ligne_id)
    items = q.all()
    return [
        LigneFactureOut(
            id=lf.id,
            facture_id=lf.facture_id,
            ligne_id=lf.ligne_id,
            abo=float(lf.abo),
            conso=float(lf.conso),
            remises=float(lf.remises),
            achat=float(lf.achat),
            statut=lf.statut,
            total_ht=lf.total_ht,
        )
        for lf in items
    ]


@router.get("/lignes-factures/{ligne_facture_id}", response_model=LigneFactureOut)
def get_ligne_facture(ligne_facture_id: int, db: Session = Depends(get_db)):
    lf = db.query(LigneFacture).filter(LigneFacture.id == ligne_facture_id).first()
    if not lf:
        raise HTTPException(status_code=404, detail="Ligne facture introuvable")
    return LigneFactureOut(
        id=lf.id,
        facture_id=lf.facture_id,
        ligne_id=lf.ligne_id,
        abo=float(lf.abo),
        conso=float(lf.conso),
        remises=float(lf.remises),
        achat=float(lf.achat),
        statut=lf.statut,
        total_ht=lf.total_ht,
    )


@router.get("/abonnements", response_model=List[AbonnementOut])
def list_abonnements(db: Session = Depends(get_db)):
    return db.query(Abonnement).order_by(Abonnement.nom).all()


@router.get("/factures/{facture_id}/abonnements")
def list_facture_abonnements(facture_id: int, db: Session = Depends(get_db)):
    # Récupère les lignes de la facture et leurs abonnements
    lignes = (
        db.query(LigneFacture, Ligne, LigneAbonnement, Abonnement)
        .join(Ligne, LigneFacture.ligne_id == Ligne.id)
        .outerjoin(LigneAbonnement, LigneAbonnement.ligne_id == Ligne.id)
        .outerjoin(Abonnement, Abonnement.id == LigneAbonnement.abonnement_id)
        .filter(LigneFacture.facture_id == facture_id)
        .all()
    )
    result = []
    for lf, l, la, ab in lignes:
        if ab is None:
            continue
        result.append(
            {
                "ligne_id": l.id,
                "ligne_type": l.type,
                "prix_abo": float(ab.prix),
                "date": la.date.isoformat() if la and la.date else None,
                "abonnement": {"id": ab.id, "nom": ab.nom, "prix": float(ab.prix), "commentaire": ab.commentaire},
            }
        )
    return result


@router.post("/query")
def execute_query(payload: dict, db: Session = Depends(get_db)):
    sql = payload.get("sql")
    if not sql or not sql.strip():
        raise HTTPException(status_code=400, detail="SQL requis")
    lowered = sql.strip().lower()
    if not lowered.startswith("select"):
        raise HTTPException(status_code=400, detail="Seules les requêtes SELECT sont autorisées.")
    rows = db.execute(text(sql)).mappings().all()
    logger.info("Query exécutée rows=%s", len(rows))
    return {"data": [dict(r) for r in rows], "count": len(rows)}


@router.get("/uploads/{upload_id}/download")
def download_upload(upload_id: str):
    meta = get_upload(upload_id)
    if not meta:
        raise HTTPException(status_code=404, detail="Upload introuvable")
    content = load_upload_bytes(upload_id)
    filename = meta.get("original_name") or f"{upload_id}.csv"
    return Response(content, media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@router.get("/factures/{facture_id}/rapport", response_model=FactureRapportOut)
def get_facture_rapport(facture_id: int, db: Session = Depends(get_db)):
    report = db.query(FactureReport).filter(FactureReport.facture_id == facture_id).first()
    if not report:
        raise HTTPException(status_code=404, detail="Rapport introuvable")
    return FactureRapportOut(
        facture_id=facture_id,
        commentaire=report.commentaire,
        data=report.data,
        updated_at=report.updated_at,
    )
