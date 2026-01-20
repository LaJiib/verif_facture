"""Pydantic schemas for v2 API."""

from __future__ import annotations

from datetime import date, datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class EntrepriseBase(BaseModel):
    nom: str


class EntrepriseOut(EntrepriseBase):
    id: int

    class Config:
        from_attributes = True


class EntrepriseDeleteResult(BaseModel):
    deleted_id: int
    cascade: Dict[str, int]


class CompteBase(BaseModel):
    num: str
    entreprise_id: int
    nom: Optional[str] = None
    lot: Optional[str] = None


class CompteOut(CompteBase):
    id: int

    class Config:
        from_attributes = True


class LigneBase(BaseModel):
    num: str
    type: int = Field(0, ge=0)
    compte_id: int


class LigneOut(LigneBase):
    id: int

    class Config:
        from_attributes = True


class FactureBase(BaseModel):
    numero_facture: str
    compte_id: int
    date: date
    abo: float = 0
    conso: float = 0
    remises: float = 0
    achat: float = 0
    statut: int = 0
    csv_id: Optional[str] = None


class FactureOut(FactureBase):
    id: int
    total_ht: float

    class Config:
        from_attributes = True


class LigneFactureBase(BaseModel):
    facture_id: int
    ligne_id: int
    abo: float = 0
    conso: float = 0
    remises: float = 0
    achat: float = 0
    statut: int = 0


class LigneFactureOut(LigneFactureBase):
    id: int
    total_ht: float

    class Config:
        from_attributes = True


class AbonnementBase(BaseModel):
    nom: str
    prix: float = 0
    commentaire: Optional[str] = None


class AbonnementOut(AbonnementBase):
    id: int

    class Config:
        from_attributes = True


class AbonnementAttachPayload(BaseModel):
    ligne_ids: List[int]
    abonnement_id: Optional[int] = None
    nom: Optional[str] = None
    prix: Optional[float] = None
    date: Optional[date] = None


class FactureRapportPayload(BaseModel):
    facture_id: int
    commentaire: Optional[str] = None
    data: Optional[Dict[str, Any]] = None


class FactureRapportOut(BaseModel):
    facture_id: int
    commentaire: Optional[str] = None
    data: Optional[Dict[str, Any]] = None
    updated_at: datetime


class UploadMeta(BaseModel):
    upload_id: str
    original_name: str
    category: Optional[str] = None
    uploaded_at: Optional[str] = None
    uploaded_month: Optional[str] = None
    size: int
    relative_path: Optional[str] = None
    saved_as: Optional[str] = None
    extra: Optional[Dict[str, Any]] = None


class UploadListResponse(BaseModel):
    entreprise: EntrepriseOut
    uploads: List[UploadMeta]


class DashboardStats(BaseModel):
    nb_comptes: int
    nb_lignes: int
    nb_factures: int


class DashboardMonth(BaseModel):
    mois: str
    total_ht: float
    nb_factures: int
    statuts: Dict[int, int]
    categories: Dict[str, float]
    delta_pct: Optional[float] = None
    trend: Optional[str] = None
    categories_delta: Optional[Dict[str, float]] = None


class DashboardResponse(BaseModel):
    entreprise: EntrepriseOut
    stats: DashboardStats
    lignes_par_type: List[Dict[str, int]]
    statuts_global: Dict[int, int]
    months: List[DashboardMonth]
    last_month: Optional[DashboardMonth] = None
    prev_month: Optional[DashboardMonth] = None


class MatriceFactureItem(BaseModel):
    facture_id: int
    facture_num: str
    statut: int
    date_key: str
    abo: float
    conso: float
    remises: float
    achat: float
    total_ht: float
    csv_id: Optional[str] = None


class CompteMatrice(BaseModel):
    compte_id: int
    compte_num: str
    compte_nom: Optional[str] = None
    lot: Optional[str] = None
    factures: List[MatriceFactureItem]


class LotMatrice(BaseModel):
    lot: str
    comptes: List[CompteMatrice]
    totals_by_month: Dict[str, float] = {}
    statuts_by_month: Dict[str, Dict[int, int]] = {}


class MatriceResponse(BaseModel):
    entreprise: EntrepriseOut
    months: List[str]
    lots: List[LotMatrice]


class FactureDetailLine(BaseModel):
    ligne_facture_id: int
    ligne_id: int
    ligne_num: str
    ligne_type: int
    abo: float
    conso: float
    remises: float
    achat: float
    total_ht: float
    statut: int


class FactureDetail(BaseModel):
    facture: FactureOut
    compte: CompteOut
    lignes: List[FactureDetailLine]
    abonnements: List[Dict[str, Any]]


class FactureDetailStats(BaseModel):
    stats_globales: Dict[str, float]
    stats_globales_prev: Optional[Dict[str, float]] = None
    months: List[Dict[str, Any]]
    lignes_by_id: Dict[int, Dict[str, Any]]
    facture_detail: FactureDetail


class AutoVerifResult(BaseModel):
    statut: str
    ecart: float
    commentaire: str
    rows_missing_count: int = 0
    details: Optional[Dict[str, Any]] = None
