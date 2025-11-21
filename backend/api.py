"""
API REST simple pour la gestion des factures télécom.

Endpoints organisés par ressource:
- /entreprises: Gestion des entreprises
- /comptes: Gestion des comptes (lignes télécom)
- /factures: Gestion des factures
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

from .models import Base, Entreprise, Compte, Facture

# Configuration du logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Configuration de la base de données
# Use absolute path to ensure database is always in backend directory
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
# SCHEMAS PYDANTIC
# ============================================================================

class EntrepriseCreate(BaseModel):
    nom: str


class EntrepriseResponse(BaseModel):
    id: int
    nom: str

    class Config:
        from_attributes = True


class CompteCreate(BaseModel):
    id: str  # Numéro d'accès
    type: str
    entreprise_id: int
    lot: Optional[str] = None


class CompteUpdate(BaseModel):
    type: Optional[str] = None
    lot: Optional[str] = None


class CompteResponse(BaseModel):
    id: str
    type: str
    entreprise_id: int
    lot: Optional[str]

    class Config:
        from_attributes = True


class FactureCreate(BaseModel):
    numero_facture: int
    compte_id: str
    date: date
    abo: float
    conso: float
    remise: float
    statut: str = "importee"


class FactureUpdate(BaseModel):
    statut: Optional[str] = None


class FactureResponse(BaseModel):
    id: int
    numero_facture: int
    compte_id: str
    date: date
    abo: float
    conso: float
    remise: float
    statut: str
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
    db_entreprise = Entreprise(nom=entreprise.nom)
    db.add(db_entreprise)
    try:
        db.commit()
        db.refresh(db_entreprise)
        return db_entreprise
    except Exception as e:
        db.rollback()
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
    """Supprime une entreprise et tous ses comptes/factures."""
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
    logger.info(f"Tentative de création du compte: {compte.dict()}")
    db_compte = Compte(**compte.dict())
    db.add(db_compte)
    try:
        db.commit()
        db.refresh(db_compte)
        logger.info(f"Compte créé avec succès: {db_compte.id} (type={db_compte.type}, entreprise_id={db_compte.entreprise_id})")
        return db_compte
    except Exception as e:
        db.rollback()
        logger.error(f"Erreur lors de la création du compte {compte.id}: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/comptes/{compte_id}", response_model=CompteResponse)
def get_compte(compte_id: str, db: Session = Depends(get_db)):
    """Récupère un compte par ID (numéro d'accès)."""
    compte = db.query(Compte).filter(Compte.id == compte_id).first()
    if not compte:
        raise HTTPException(status_code=404, detail="Compte non trouvé")
    return compte


@app.put("/comptes/{compte_id}", response_model=CompteResponse)
def update_compte(compte_id: str, compte: CompteUpdate, db: Session = Depends(get_db)):
    """Met à jour le type ou le lot d'un compte."""
    db_compte = db.query(Compte).filter(Compte.id == compte_id).first()
    if not db_compte:
        raise HTTPException(status_code=404, detail="Compte non trouvé")

    if compte.type is not None:
        db_compte.type = compte.type
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
def delete_compte(compte_id: str, db: Session = Depends(get_db)):
    """Supprime un compte et toutes ses factures."""
    db_compte = db.query(Compte).filter(Compte.id == compte_id).first()
    if not db_compte:
        raise HTTPException(status_code=404, detail="Compte non trouvé")

    db.delete(db_compte)
    db.commit()
    return {"message": "Compte supprimé"}


# ============================================================================
# ENDPOINTS - FACTURES
# ============================================================================

@app.get("/factures", response_model=List[FactureResponse])
def list_factures(
    compte_id: Optional[str] = None,
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
    logger.info(f"Tentative de création de facture: compte_id={facture.compte_id}, date={facture.date}, abo={facture.abo}, conso={facture.conso}")
    db_facture = Facture(**facture.dict())
    db.add(db_facture)
    try:
        db.commit()
        db.refresh(db_facture)
        logger.info(f"Facture créée avec succès: id={db_facture.id}, compte_id={db_facture.compte_id}, date={db_facture.date}, total_ht={db_facture.total_ht}")
        return db_facture
    except Exception as e:
        db.rollback()
        logger.error(f"Erreur lors de la création de la facture (compte_id={facture.compte_id}, date={facture.date}): {str(e)}")
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
    """Met à jour le statut d'une facture."""
    db_facture = db.query(Facture).filter(Facture.id == facture_id).first()
    if not db_facture:
        raise HTTPException(status_code=404, detail="Facture non trouvée")

    if facture.statut is not None:
        db_facture.statut = facture.statut

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
