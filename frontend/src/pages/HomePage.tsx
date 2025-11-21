import { useEffect, useState } from "react";
import { fetchEntreprises, createEntreprise, type Entreprise } from "../entrepriseApi";

interface HomePageProps {
  onSelectEntreprise: (entrepriseId: number) => void;
  onNavigateToImport: () => void;
}

export default function HomePage({ onSelectEntreprise, onNavigateToImport }: HomePageProps) {
  const [entreprises, setEntreprises] = useState<Entreprise[]>([]);
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
      const data = await fetchEntreprises();
      setEntreprises(data);
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
      setEntreprises([...entreprises, newEntreprise]);
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
                  <span className="stat-value">{entreprise.nb_lignes}</span>
                  <span className="stat-label">Lignes</span>
                </div>
                <div className="stat">
                  <span className="stat-value">{entreprise.nb_records}</span>
                  <span className="stat-label">Records</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
