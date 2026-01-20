"""Write-only endpoints (commands)."""

from __future__ import annotations

from datetime import date
from typing import Dict
import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import IntegrityError
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
    FactureReport,
)
from ..storage import delete_upload
from .schemas import (
    EntrepriseBase,
    EntrepriseOut,
    EntrepriseDeleteResult,
    CompteBase,
    CompteOut,
    LigneBase,
    LigneOut,
    FactureBase,
    FactureOut,
    LigneFactureBase,
    LigneFactureOut,
    AbonnementBase,
    AbonnementOut,
    AbonnementAttachPayload,
    FactureRapportPayload,
    FactureRapportOut,
)

logger = logging.getLogger("api_v2.cmd")

router = APIRouter(prefix="/v2/cmd", tags=["cmd"])


def _commit(db: Session):
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail=f"Contrainte violée: {exc.orig}") from exc


@router.post("/entreprises/create", response_model=EntrepriseOut)
def create_entreprise(payload: EntrepriseBase, db: Session = Depends(get_db)):
    ent = Entreprise(nom=payload.nom.strip())
    db.add(ent)
    _commit(db)
    db.refresh(ent)
    logger.info("Entreprise créée id=%s nom=%s", ent.id, ent.nom)
    return ent


@router.post("/entreprises/{id}/rename", response_model=EntrepriseOut)
def rename_entreprise(id: int, payload: EntrepriseBase, db: Session = Depends(get_db)):
    ent = db.query(Entreprise).filter(Entreprise.id == id).first()
    if not ent:
        raise HTTPException(status_code=404, detail="Entreprise introuvable")
    ent.nom = payload.nom.strip()
    _commit(db)
    db.refresh(ent)
    logger.info("Entreprise renommée id=%s", ent.id)
    return ent


@router.post("/entreprises/{id}/delete", response_model=EntrepriseDeleteResult)
def delete_entreprise(id: int, db: Session = Depends(get_db)):
    ent = db.query(Entreprise).filter(Entreprise.id == id).first()
    if not ent:
        raise HTTPException(status_code=404, detail="Entreprise introuvable")
    stats = {
        "comptes": len(ent.comptes),
        "factures": sum(len(c.factures) for c in ent.comptes),
        "lignes": sum(len(c.lignes) for c in ent.comptes),
    }
    db.delete(ent)
    _commit(db)
    logger.warning("Entreprise supprimée id=%s cascade=%s", id, stats)
    return EntrepriseDeleteResult(deleted_id=id, cascade=stats)


@router.post("/comptes/create", response_model=CompteOut)
def create_compte(payload: CompteBase, db: Session = Depends(get_db)):
    compte = Compte(
        num=payload.num.strip(),
        nom=payload.nom,
        lot=payload.lot,
        entreprise_id=payload.entreprise_id,
    )
    db.add(compte)
    _commit(db)
    db.refresh(compte)
    logger.info("Compte créé id=%s entreprise_id=%s", compte.id, compte.entreprise_id)
    return compte


@router.post("/comptes/{id}/update", response_model=CompteOut)
def update_compte(id: int, payload: Dict, db: Session = Depends(get_db)):
    compte = db.query(Compte).filter(Compte.id == id).first()
    if not compte:
        raise HTTPException(status_code=404, detail="Compte introuvable")
    if "nom" in payload:
        compte.nom = payload.get("nom")
    if "lot" in payload:
        compte.lot = payload.get("lot")
    _commit(db)
    db.refresh(compte)
    logger.info("Compte mis à jour id=%s", compte.id)
    return compte


@router.post("/comptes/{id}/delete")
def delete_compte(id: int, db: Session = Depends(get_db)):
    compte = db.query(Compte).filter(Compte.id == id).first()
    if not compte:
        raise HTTPException(status_code=404, detail="Compte introuvable")
    db.delete(compte)
    _commit(db)
    logger.warning("Compte supprimé id=%s", id)
    return {"deleted_id": id}


@router.post("/lignes/create", response_model=LigneOut)
def create_ligne(payload: LigneBase, db: Session = Depends(get_db)):
    ligne = Ligne(num=payload.num.strip(), type=payload.type, compte_id=payload.compte_id)
    db.add(ligne)
    _commit(db)
    db.refresh(ligne)
    return ligne


@router.post("/lignes/{id}/update", response_model=LigneOut)
def update_ligne(id: int, payload: Dict, db: Session = Depends(get_db)):
    ligne = db.query(Ligne).filter(Ligne.id == id).first()
    if not ligne:
        raise HTTPException(status_code=404, detail="Ligne introuvable")
    if "type" in payload:
        ligne.type = int(payload["type"])
    _commit(db)
    db.refresh(ligne)
    return ligne


@router.post("/lignes/{id}/delete")
def delete_ligne(id: int, db: Session = Depends(get_db)):
    ligne = db.query(Ligne).filter(Ligne.id == id).first()
    if not ligne:
        raise HTTPException(status_code=404, detail="Ligne introuvable")
    db.delete(ligne)
    _commit(db)
    return {"deleted_id": id}


@router.post("/factures/create", response_model=FactureOut)
def create_facture(payload: FactureBase, db: Session = Depends(get_db)):
    compte = db.query(Compte).filter(Compte.id == payload.compte_id).first()
    if not compte:
        raise HTTPException(status_code=404, detail="Compte introuvable")
    facture = Facture(
        num=str(payload.numero_facture),
        compte_id=payload.compte_id,
        date=payload.date,
        abo=payload.abo,
        conso=payload.conso,
        remises=payload.remises,
        achat=payload.achat,
        statut=payload.statut,
        csv_id=payload.csv_id,
    )
    db.add(facture)
    _commit(db)
    db.refresh(facture)
    logger.info("Facture créée id=%s compte_id=%s num=%s", facture.id, facture.compte_id, facture.num)
    return FactureOut(
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


@router.post("/factures/{id}/update", response_model=FactureOut)
def update_facture(id: int, payload: Dict, db: Session = Depends(get_db)):
    facture = db.query(Facture).filter(Facture.id == id).first()
    if not facture:
        raise HTTPException(status_code=404, detail="Facture introuvable")
    if "statut" in payload:
        facture.statut = int(payload.get("statut"))
    if "abo" in payload:
        facture.abo = payload.get("abo", facture.abo)
    if "conso" in payload:
        facture.conso = payload.get("conso", facture.conso)
    if "remises" in payload:
        facture.remises = payload.get("remises", facture.remises)
    if "achat" in payload:
        facture.achat = payload.get("achat", facture.achat)
    _commit(db)
    db.refresh(facture)
    logger.info("Facture mise à jour id=%s statut=%s", facture.id, facture.statut)
    return FactureOut(
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


@router.post("/factures/{id}/delete")
def delete_facture(id: int, db: Session = Depends(get_db)):
    facture = db.query(Facture).filter(Facture.id == id).first()
    if not facture:
        raise HTTPException(status_code=404, detail="Facture introuvable")
    db.delete(facture)
    _commit(db)
    logger.warning("Facture supprimée id=%s", id)
    return {"deleted_id": id}


@router.post("/lignes-factures/create", response_model=LigneFactureOut)
def create_ligne_facture(payload: LigneFactureBase, db: Session = Depends(get_db)):
    lf = LigneFacture(
        facture_id=payload.facture_id,
        ligne_id=payload.ligne_id,
        abo=payload.abo,
        conso=payload.conso,
        remises=payload.remises,
        achat=payload.achat,
        statut=payload.statut,
    )
    db.add(lf)
    _commit(db)
    db.refresh(lf)
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


@router.post("/lignes-factures/{id}/update", response_model=LigneFactureOut)
def update_ligne_facture(id: int, payload: dict, db: Session = Depends(get_db)):
    lf = db.query(LigneFacture).filter(LigneFacture.id == id).first()
    if not lf:
        raise HTTPException(status_code=404, detail="Ligne facture introuvable")
    if "abo" in payload:
        lf.abo = payload.get("abo", lf.abo)
    if "conso" in payload:
        lf.conso = payload.get("conso", lf.conso)
    if "remises" in payload:
        lf.remises = payload.get("remises", lf.remises)
    if "achat" in payload:
        lf.achat = payload.get("achat", lf.achat)
    if "statut" in payload:
        lf.statut = payload.get("statut", lf.statut)
    if "facture_id" in payload:
        lf.facture_id = payload.get("facture_id", lf.facture_id)
    if "ligne_id" in payload:
        lf.ligne_id = payload.get("ligne_id", lf.ligne_id)
    _commit(db)
    db.refresh(lf)
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


@router.post("/lignes-factures/{id}/delete")
def delete_ligne_facture(id: int, db: Session = Depends(get_db)):
    lf = db.query(LigneFacture).filter(LigneFacture.id == id).first()
    if not lf:
        raise HTTPException(status_code=404, detail="Ligne facture introuvable")
    db.delete(lf)
    _commit(db)
    return {"deleted_id": id}


@router.post("/abonnements/create", response_model=AbonnementOut)
def create_abonnement(payload: AbonnementBase, db: Session = Depends(get_db)):
    ab = Abonnement(nom=payload.nom.strip(), prix=payload.prix, commentaire=payload.commentaire)
    db.add(ab)
    _commit(db)
    db.refresh(ab)
    return ab


@router.post("/abonnements/{id}/update", response_model=AbonnementOut)
def update_abonnement(id: int, payload: AbonnementBase, db: Session = Depends(get_db)):
    ab = db.query(Abonnement).filter(Abonnement.id == id).first()
    if not ab:
        raise HTTPException(status_code=404, detail="Abonnement introuvable")
    ab.nom = payload.nom.strip()
    ab.prix = payload.prix
    ab.commentaire = payload.commentaire
    _commit(db)
    db.refresh(ab)
    return ab


@router.post("/abonnements/{id}/delete")
def delete_abonnement(id: int, db: Session = Depends(get_db)):
    ab = db.query(Abonnement).filter(Abonnement.id == id).first()
    if not ab:
        raise HTTPException(status_code=404, detail="Abonnement introuvable")
    db.delete(ab)
    _commit(db)
    return {"deleted_id": id}


@router.post("/abonnements/attacher")
def attacher_abonnement(payload: AbonnementAttachPayload, db: Session = Depends(get_db)):
    abonnement_id = payload.abonnement_id
    if abonnement_id is None:
        if not payload.nom:
            raise HTTPException(status_code=400, detail="Nom requis pour créer un abonnement")
        ab = Abonnement(nom=payload.nom.strip(), prix=payload.prix or 0)
        db.add(ab)
        _commit(db)
        db.refresh(ab)
        abonnement_id = ab.id
    ab = db.query(Abonnement).filter(Abonnement.id == abonnement_id).first()
    if not ab:
        raise HTTPException(status_code=404, detail="Abonnement introuvable")

    attached = 0
    for ligne_id in payload.ligne_ids:
        existing = (
            db.query(LigneAbonnement)
            .filter(LigneAbonnement.ligne_id == ligne_id, LigneAbonnement.abonnement_id == abonnement_id)
            .first()
        )
        if existing:
            continue
        link = LigneAbonnement(ligne_id=ligne_id, abonnement_id=abonnement_id, date=payload.date)
        db.add(link)
        attached += 1
    _commit(db)
    return {"abonnement_id": abonnement_id, "attached": attached}


@router.post("/abonnements/detacher")
def detacher_abonnement(abonnement_id: int, ligne_id: int, db: Session = Depends(get_db)):
    link = (
        db.query(LigneAbonnement)
        .filter(LigneAbonnement.abonnement_id == abonnement_id, LigneAbonnement.ligne_id == ligne_id)
        .first()
    )
    if not link:
        raise HTTPException(status_code=404, detail="Lien abonnement introuvable")
    db.delete(link)
    _commit(db)
    return {"deleted": True}


@router.post("/uploads/delete")
def delete_upload_cmd(upload_id: str):
    deleted = delete_upload(upload_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Upload introuvable")
    logger.warning("Upload supprimé upload_id=%s", upload_id)
    return {"deleted": True, "upload_id": upload_id}


@router.post("/shutdown")
def shutdown_server():
    """Simple shutdown hook used by the dev script."""
    import os
    import signal

    os.kill(os.getpid(), signal.SIGTERM)
    return {"status": "terminating"}


@router.put("/factures/{facture_id}/rapport", response_model=FactureRapportOut)
def upsert_facture_rapport(facture_id: int, payload: FactureRapportPayload, db: Session = Depends(get_db)):
    facture = db.query(Facture).filter(Facture.id == facture_id).first()
    if not facture:
        raise HTTPException(status_code=404, detail="Facture introuvable")
    report = db.query(FactureReport).filter(FactureReport.facture_id == facture_id).first()
    if not report:
        report = FactureReport(facture_id=facture_id)
        db.add(report)
    report.commentaire = payload.commentaire
    report.data = payload.data
    _commit(db)
    db.refresh(report)
    return FactureRapportOut(
        facture_id=facture_id,
        commentaire=report.commentaire,
        data=report.data,
        updated_at=report.updated_at,
    )
