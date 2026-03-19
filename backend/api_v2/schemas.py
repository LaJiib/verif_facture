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
    nom: Optional[str] = None
    sous_compte: Optional[str] = None


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
    entreprise_id: Optional[int] = None


class AbonnementOut(AbonnementBase):
    id: int

    class Config:
        from_attributes = True


class AbonnementAttachPayload(BaseModel):
    ligne_ids: List[int]
    abonnement_id: Optional[int] = None
    nom: Optional[str] = None
    prix: Optional[float] = None
    commentaire: Optional[str] = None
    entreprise_id: Optional[int] = None
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


class AbonnementUsage(BaseModel):
    id: int
    nom: str
    prix: float
    commentaire: Optional[str] = None
    nb_lignes: int = 0
    nb_factures: int = 0
    total_ht: float = 0


class AbonnementStatsResponse(BaseModel):
    mois: str
    abonnements: List[AbonnementUsage]
    lignes_sans_abonnement: int = 0


class LignesParTypeLot(BaseModel):
    lot: str
    total: int
    comptes: List[Dict[str, Any]]


class LignesParTypeResponse(BaseModel):
    type: int
    lots: List[LignesParTypeLot]


class LigneTimelineFacture(BaseModel):
    facture_id: int
    facture_num: str
    date: str
    statut: int
    abo: float
    conso: float
    remises: float
    achat: float
    total_ht: float
    ligne_facture_id: int
    ligne_statut: int


class LigneAbonnementHistory(BaseModel):
    abonnement_id: int
    nom: str
    prix: float
    date: Optional[str] = None


class LigneTimelineResponse(BaseModel):
    ligne: Dict[str, Any]
    factures: List[LigneTimelineFacture]
    abonnements: List[LigneAbonnementHistory]
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
    nom: Optional[str] = None
    ligne_type: int
    sous_compte: Optional[str] = None
    abo: float
    conso: float
    remises: float
    achat: float
    total_ht: float
    statut: int
    abo_id_ref: Optional[int] = None
    abo_nom_ref: Optional[str] = None
    abo_prix_ref: Optional[float] = None


class FactureDetail(BaseModel):
    facture: FactureOut
    compte: CompteOut
    lignes: List[FactureDetailLine]
    abonnements: List[Dict[str, Any]]


class LigneGroupe(BaseModel):
    facture_id: int
    group_key: str
    ligne_type: int
    abo_id_ref: Optional[int] = None
    abo_nom_ref: Optional[str] = None
    prix_abo: float
    count: int
    abo: float
    remises: float
    netAbo: float
    conso: float
    achat: float
    total: float
    ligne_ids: Optional[List[int]] = None
    ligne_facture_ids: Optional[List[int]] = None


class FactureResume(BaseModel):
    facture_id: int
    facture_num: str
    facture_date: str
    total_ht: float
    lignes_total: float
    abo: float
    conso: float
    remises: float
    achat: float
    ecart: float


class FactureDetailStats(BaseModel):
    stats_globales: Dict[str, float]
    stats_globales_prev: Optional[Dict[str, float]] = None
    months: List[Dict[str, Any]]
    lignes_by_id: Dict[int, Dict[str, Any]]
    facture_detail: FactureDetail
    ligne_groupes: List[LigneGroupe] = []
    factures_resume: List[FactureResume] = []


class AutoVerifResult(BaseModel):
    statut: str
    ecart: float
    commentaire: str
    rows_missing_count: int = 0
    details: Optional[Dict[str, Any]] = None


class AutoVerifGroupStatut(BaseModel):
    aboNet: str
    achat: str


class AutoVerifAnomaly(BaseModel):
    kind: str
    line: Optional[str] = None
    detail: str
    prev_net: Optional[float] = None
    curr_net: Optional[float] = None
    prev_achat: Optional[float] = None
    curr_achat: Optional[float] = None

class LineStatutItem(BaseModel):
    aboNet: str
    achat: str
    comment: Optional[str] = None


class AutoVerifGroupItem(BaseModel):
    groupKey: str
    ligneFactureIds: List[int] = []
    statut: AutoVerifGroupStatut
    comments: Dict[str, Optional[str]] = {}
    anomalies: List[AutoVerifAnomaly] = []


class AutoVerifFullResult(BaseModel):
    metricStatuts: Dict[str, str]
    metricComments: Dict[str, str]
    metricReals: Dict[str, str]
    groupStatuts: Dict[str, AutoVerifGroupStatut]
    groupComments: Dict[str, Dict[str, Optional[str]]]
    groupAnomalies: Dict[str, List[AutoVerifAnomaly]]
    groups: List[AutoVerifGroupItem] = []
    summary: Dict[str, Any]
    previousFactureNum: Optional[str] = None
    lineStatuts: Dict[int, LineStatutItem] = {}  # keyed by ligne_facture_id
