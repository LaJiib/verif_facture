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
from datetime import date
from pathlib import Path
import logging
from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, sessionmaker

from .models import Base, Entreprise, Compte, Ligne, Facture, LigneFacture

# Configuration du logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Configuration de la base de données
DB_PATH = Path(__file__).parent / "invoices.db"
DATABASE_URL = f"sqlite:///{DB_PATH}"
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Create all tables on startup
Base.metadata.create_all(bind=engine)

app = FastAPI(title="Vérification Factures Télécom")

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
    type: str
    compte_id: int


class LigneUpdate(BaseModel):
    type: Optional[str] = None


class LigneResponse(BaseModel):
    id: int
    num: str
    type: str
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
    statut: str = "importé"


class FactureUpdate(BaseModel):
    abo: Optional[float] = None
    conso: Optional[float] = None
    remises: Optional[float] = None
    achat: Optional[float] = None
    statut: Optional[str] = None


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
    statut: str
    total_ht: float

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

    db.delete(db_entreprise)
    db.commit()
    return {"message": "Entreprise supprimée"}


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

    try:
        db.commit()
        db.refresh(db_facture)
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
