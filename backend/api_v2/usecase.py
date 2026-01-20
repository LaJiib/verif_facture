"""Use-case endpoints orchestrating multiple commands."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func

from ..database import get_db
from ..models import Facture, LigneFacture, Ligne
from .schemas import AutoVerifResult

router = APIRouter(prefix="/v2/usecase", tags=["usecase"])
logger = logging.getLogger("api_v2.usecase")


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
    ecart = round(total_lignes - total_facture, 2)
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
