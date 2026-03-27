"""Write-only endpoints (commands)."""

from __future__ import annotations

from datetime import date
from typing import Any, Dict, List
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


def _compute_facture_statut(db: Session, facture_id: int) -> int | None:
    """
    Calcule le statut cible d'une facture selon:
    - statuts des lignes (si présentes)
    - statut global d'écart (report.data.metricStatuts.ecart)

    Règle métier:
    - conteste si un élément est contesté (écart ou ligne)
    - valide si tout est validé
    - sinon à vérifier (code 0)
    """
    facture = db.query(Facture).filter(Facture.id == facture_id).first()
    if not facture:
        return None

    ligne_statuts = [s for (s,) in db.query(LigneFacture.statut).filter(LigneFacture.facture_id == facture_id).all()]

    ecart_statut = None
    report = db.query(FactureReport).filter(FactureReport.facture_id == facture_id).first()
    try:
        if report and report.data:
            ecart_statut = (report.data or {}).get("metricStatuts", {}).get("ecart")
    except Exception:
        ecart_statut = None

    # Priorité absolue: un conteste global ou ligne => facture contestée.
    if ecart_statut == "conteste":
        return 2

    # Cas avec lignes: toutes valides + écart valide => facture validée.
    if ligne_statuts:
        any_conteste = any(s == 2 for s in ligne_statuts)
        any_import = any(s in (0, None) for s in ligne_statuts)
        all_valid = not any_conteste and not any_import

        if any_conteste:
            return 2
        if all_valid and ecart_statut == "valide":
            return 1
        return 0

    # Cas sans lignes: on se base uniquement sur l'écart.
    if ecart_statut == "valide":
        return 1
    return 0


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
    statut_provided = "statut" in payload and payload.get("statut") is not None
    logger.info("Updating facture id=%s statut_provided=%s", id, statut_provided)
    if statut_provided:
        facture.statut = int(payload.get("statut"))
    logger.info("Facture update id=%s statut=%s", id, facture.statut)
    if "abo" in payload:
        facture.abo = payload.get("abo", facture.abo)
    if "conso" in payload:
        facture.conso = payload.get("conso", facture.conso)
    if "remises" in payload:
        facture.remises = payload.get("remises", facture.remises)
    if "achat" in payload:
        facture.achat = payload.get("achat", facture.achat)
    _commit(db)
    # Recalcule toujours le statut en fonction des règles backend (lignes + écart) et applique via update_facture
    new_statut = _compute_facture_statut(db, id)
    if new_statut is not None and new_statut != facture.statut:
        facture.statut = new_statut
        db.add(facture)
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
    facture_id = lf.facture_id
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
        facture_id = lf.facture_id
    if "ligne_id" in payload:
        lf.ligne_id = payload.get("ligne_id", lf.ligne_id)
    _commit(db)
    db.refresh(lf)
    new_statut = _compute_facture_statut(db, facture_id)
    if new_statut is not None:
        db.query(Facture).filter(Facture.id == facture_id).update({"statut": new_statut})
        db.commit()

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
    if payload.entreprise_id is None:
        raise HTTPException(status_code=400, detail="entreprise_id requis pour crßer un abonnement")
    ab = Abonnement(
        nom=payload.nom.strip(),
        prix=payload.prix,
        commentaire=payload.commentaire,
        entreprise_id=payload.entreprise_id,
    )
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
    if payload.entreprise_id is not None:
        ab.entreprise_id = payload.entreprise_id
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
    if not payload.ligne_ids:
        raise HTTPException(status_code=400, detail="Aucune ligne fournie")
    # Determine l'entreprise à partir de la première ligne cible
    first_line = db.query(Ligne).filter(Ligne.id == payload.ligne_ids[0]).first()
    if not first_line:
        raise HTTPException(status_code=404, detail="Ligne introuvable")
    compte = db.query(Compte).filter(Compte.id == first_line.compte_id).first()
    if not compte:
        raise HTTPException(status_code=404, detail="Compte introuvable")
    entreprise_id = compte.entreprise_id

    abonnement_id = payload.abonnement_id
    if abonnement_id is None:
        if not payload.nom:
            raise HTTPException(status_code=400, detail="Nom requis pour créer un abonnement")
        ab = Abonnement(
            nom=payload.nom.strip(),
            prix=payload.prix or 0,
            commentaire=payload.commentaire,
            entreprise_id=entreprise_id,
        )
        db.add(ab)
        db.flush()  # besoin de l'id avant de créer les liaisons
        abonnement_id = ab.id
    ab = db.query(Abonnement).filter(Abonnement.id == abonnement_id).first()
    if not ab:
        raise HTTPException(status_code=404, detail="Abonnement introuvable")
    # Vérifie cohérence entreprise
    if ab.entreprise_id and ab.entreprise_id != entreprise_id:
        raise HTTPException(status_code=400, detail="Abonnement appartenant à une autre entreprise")
    if ab.entreprise_id is None:
        ab.entreprise_id = entreprise_id

    if payload.prix is not None:
        ab.prix = payload.prix
    if payload.commentaire is not None:
        ab.commentaire = payload.commentaire

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
    db.refresh(ab)
    return {
        "abonnement": {
            "id": ab.id,
            "nom": ab.nom,
            "prix": float(ab.prix),
            "commentaire": ab.commentaire,
            "entreprise_id": ab.entreprise_id,
        },
        "ligne_ids": payload.ligne_ids,
        "date": payload.date.isoformat() if payload.date else None,
        "attached": attached,
    }


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

    # Apply line statuses from report payload.
    # Priority:
    # 1) data.groups[].ligneFactureIds (new structure)
    # 2) data.lineStatuts (per-line structure)
    # 3) data.groupStatuts (legacy grouped structure)
    try:
        data = payload.data or {}
        groups = data.get("groups") or []
        line_statuts = data.get("lineStatuts") or {}
        group_statuts = data.get("groupStatuts") or {}

        def derive_statut(stat: Dict[str, Any] | None) -> int | None:
            if not stat:
                return None
            abo_net = stat.get("aboNet")
            achat = stat.get("achat")
            if abo_net == "conteste" or achat == "conteste":
                return 2
            if (abo_net in (None, "valide")) and (achat in (None, "valide")):
                return 1
            return 0

        lignes = (
            db.query(LigneFacture, Ligne)
            .join(Ligne, LigneFacture.ligne_id == Ligne.id)
            .filter(LigneFacture.facture_id == facture_id)
            .all()
        )
        allowed_lf_ids = {int(lf.id) for lf, _ in lignes}
        updates_by_lf: Dict[int, int] = {}

        # 1) New grouped structure (robust against key-format drift).
        if isinstance(groups, list):
            for group_item in groups:
                if not isinstance(group_item, dict):
                    continue
                group_stat = group_item.get("statut") or group_item.get("statuts") or group_item.get("status")
                statut_val = derive_statut(group_stat if isinstance(group_stat, dict) else None)
                if statut_val is None:
                    continue
                lf_ids = group_item.get("ligneFactureIds") or group_item.get("ligne_facture_ids") or []
                if not isinstance(lf_ids, list):
                    continue
                for raw_id in lf_ids:
                    try:
                        lf_id = int(raw_id)
                    except Exception:
                        continue
                    if lf_id in allowed_lf_ids:
                        updates_by_lf[lf_id] = statut_val

        # 2) Per-line payload fallback (keeps compatibility with old save flow).
        if isinstance(line_statuts, dict):
            for raw_id, stat in line_statuts.items():
                try:
                    lf_id = int(raw_id)
                except Exception:
                    continue
                if lf_id not in allowed_lf_ids or lf_id in updates_by_lf:
                    continue
                statut_val = derive_statut(stat if isinstance(stat, dict) else None)
                if statut_val is not None:
                    updates_by_lf[lf_id] = statut_val

        # 3) Legacy grouped map fallback.
        if isinstance(group_statuts, dict) and group_statuts:
            abo_links = (
                db.query(LigneAbonnement, Abonnement)
                .join(Abonnement, LigneAbonnement.abonnement_id == Abonnement.id)
                .filter(LigneAbonnement.ligne_id.in_([l.id for _, l in lignes]))
                .order_by(LigneAbonnement.date.desc())
                .all()
            )
            abo_map = {}
            for la, ab in abo_links:
                if la.ligne_id not in abo_map:
                    abo_map[la.ligne_id] = ab

            def normalize_key(key: str) -> str:
                if key.startswith("price|") or key.startswith("abo|"):
                    return key
                parts = key.split("|")
                if len(parts) == 2:
                    t, net = parts
                    try:
                        netv = float(net)
                    except Exception:
                        netv = 0.0
                    return f"price|{t}|{netv:.2f}"
                return key

            group_map: Dict[str, List[int]] = {}
            for lf, ligne in lignes:
                net_unit = round(float(lf.abo + lf.remises), 2)
                abo_ref = abo_map.get(ligne.id)
                if abo_ref:
                    key = f"abo|{abo_ref.id}|{ligne.type}|{net_unit:.2f}"
                else:
                    key = f"price|{ligne.type}|{net_unit:.2f}"
                group_map.setdefault(key, []).append(int(lf.id))

            normalized_statuts = {normalize_key(str(k)): v for k, v in group_statuts.items()}
            for key, lf_ids in group_map.items():
                if key not in normalized_statuts:
                    continue
                stat = normalized_statuts.get(key)
                statut_val = derive_statut(stat if isinstance(stat, dict) else None)
                if statut_val is None:
                    continue
                for lf_id in lf_ids:
                    updates_by_lf.setdefault(lf_id, statut_val)

        if updates_by_lf:
            for lf_id, statut_val in updates_by_lf.items():
                db.query(LigneFacture).filter(LigneFacture.id == lf_id).update({"statut": int(statut_val)})
            _commit(db)
            logger.info("Rapport: statuts lignes appliques facture_id=%s updates=%s", facture_id, len(updates_by_lf))

        # Always recompute facture status after report save.
        new_statut = _compute_facture_statut(db, facture_id)
        if new_statut is not None:
            db.query(Facture).filter(Facture.id == facture_id).update({"statut": new_statut})
            db.commit()
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("Impossible d'appliquer les statuts du rapport facture_id=%s: %s", facture_id, exc)
        db.rollback()

    return FactureRapportOut(
        facture_id=facture_id,
        commentaire=report.commentaire,
        data=report.data,
        updated_at=report.updated_at,
    )
