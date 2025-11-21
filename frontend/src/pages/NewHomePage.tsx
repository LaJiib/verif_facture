import { useEffect, useState } from "react";
import {
  fetchEntreprises,
  createEntreprise,
  executeQuery,
  type Entreprise,
} from "../newApi";

interface HomePageProps {
  onSelectEntreprise: (entrepriseId: number) => void;
  onNavigateToImport: () => void;
}

interface EntrepriseWithStats extends Entreprise {
  nb_comptes: number;
  nb_factures: number;
}

export default function HomePage({
  onSelectEntreprise,
  onNavigateToImport,
}: HomePageProps) {
  const [entreprises, setEntreprises] = useState<EntrepriseWithStats[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newEntrepriseName, setNewEntrepriseName] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    loadEntreprises();
  }, []);

  async function loadEntreprises() {
    setIsLoading(true);
    setError(null);
    try {
      // Récupère toutes les entreprises
      const entreprisesData = await fetchEntreprises();

      // Récupère les stats via une requête SQL
      const statsQuery = `
        SELECT
          e.id,
          e.nom,
          COUNT(DISTINCT c.id) as nb_comptes,
          COUNT(DISTINCT f.id) as nb_factures
        FROM entreprises e
        LEFT JOIN comptes c ON c.entreprise_id = e.id
        LEFT JOIN factures f ON f.compte_id = c.id
        GROUP BY e.id, e.nom
      `;

      const statsResult = await executeQuery(statsQuery);

      // Combine les données
      const entreprisesWithStats: EntrepriseWithStats[] = entreprisesData.map(
        (entreprise) => {
          const stats = statsResult.data.find((s: any) => s.id === entreprise.id);
          return {
            ...entreprise,
            nb_comptes: stats?.nb_comptes || 0,
            nb_factures: stats?.nb_factures || 0,
          };
        }
      );

      setEntreprises(entreprisesWithStats);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleCreateEntreprise(e: React.FormEvent) {
    e.preventDefault();
    if (!newEntrepriseName.trim()) {
      setError("Le nom de l'entreprise est requis");
      return;
    }

    setIsCreating(true);
    setError(null);
    try {
      const newEntreprise = await createEntreprise(newEntrepriseName.trim());
      // Recharge la liste complète
      await loadEntreprises();
      setNewEntrepriseName("");
      setShowAddForm(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <div className="app">
      <header>
        <h1>Entreprises</h1>
        <button onClick={onNavigateToImport} className="secondary-button">
          Importer un CSV
        </button>
      </header>

      {error && <div className="alert error">{error}</div>}

      <div className="add-entreprise-section">
        <button onClick={() => setShowAddForm(!showAddForm)} type="button">
          {showAddForm ? "Annuler" : "+ Ajouter une entreprise"}
        </button>

        {showAddForm && (
          <form onSubmit={handleCreateEntreprise} className="add-form">
            <input
              type="text"
              placeholder="Nom de l'entreprise"
              value={newEntrepriseName}
              onChange={(e) => setNewEntrepriseName(e.target.value)}
              disabled={isCreating}
            />
            <button type="submit" disabled={isCreating}>
              {isCreating ? "Création..." : "Créer"}
            </button>
          </form>
        )}
      </div>

      {isLoading ? (
        <p className="loading">Chargement...</p>
      ) : entreprises.length === 0 ? (
        <div className="empty-state">
          <p>Aucune entreprise</p>
        </div>
      ) : (
        <div className="entreprises-list">
          {entreprises.map((entreprise) => (
            <div
              key={entreprise.id}
              className="entreprise-item"
              onClick={() => onSelectEntreprise(entreprise.id)}
            >
              <h3>{entreprise.nom}</h3>
              <div className="stats">
                <div className="stat">
                  <span className="stat-value">{entreprise.nb_comptes}</span>
                  <span className="stat-label">Comptes</span>
                </div>
                <div className="stat">
                  <span className="stat-value">{entreprise.nb_factures}</span>
                  <span className="stat-label">Factures</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
