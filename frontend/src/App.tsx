import { useState, useEffect } from "react";
import Sidebar from "./components/Sidebar";
import HomePage from "./pages/NewHomePage2";
import EntreprisePage from "./pages/NewEntreprisePage";
import ImportPage from "./pages/NewImportPage";
import CreateEntreprisePage from "./pages/CreateEntreprisePage";
import { fetchEntreprises } from "./newApi";

type Route =
  | { page: "home" }
  | { page: "factures" }
  | { page: "import" }
  | { page: "settings" }
  | { page: "create-entreprise" };

export default function App() {
  const [route, setRoute] = useState<Route>({ page: "home" });
  const [currentEntrepriseId, setCurrentEntrepriseId] = useState<number | null>(null);
  const [entreprises, setEntreprises] = useState<Array<{ id: number; nom: string }>>([]);

  // Charger les entreprises au démarrage
  useEffect(() => {
    loadEntreprises();
  }, []);

  async function loadEntreprises() {
    try {
      const data = await fetchEntreprises();
      setEntreprises(data);

      // Sélectionner la première entreprise par défaut si aucune n'est sélectionnée
      if (data.length > 0 && currentEntrepriseId === null) {
        setCurrentEntrepriseId(data[0].id);
      }
    } catch (error) {
      console.error("Erreur lors du chargement des entreprises:", error);
    }
  }

  function navigateToHome() {
    setRoute({ page: "home" });
  }

  function navigateToFactures() {
    setRoute({ page: "factures" });
  }

  function navigateToImport() {
    setRoute({ page: "import" });
  }

  function navigateToSettings() {
    setRoute({ page: "settings" });
  }

  function navigateToCreateEntreprise() {
    setRoute({ page: "create-entreprise" });
  }

  function handleSelectEntreprise(entrepriseId: number) {
    setCurrentEntrepriseId(entrepriseId);
    setRoute({ page: "home" });
  }

  // Si aucune entreprise n'est sélectionnée
  if (currentEntrepriseId === null && entreprises.length === 0 &&
    route.page !== "create-entreprise") {
    return (
      <div style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        height: "100vh",
        flexDirection: "column",
        gap: "1rem"
      }}>
        <p>Aucune entreprise disponible</p>
        <button
          onClick={navigateToCreateEntreprise}
          style={{
            background: "#3b82f6",
            color: "white",
            border: "none",
            borderRadius: "0.5rem",
            padding: "0.75rem 1.5rem",
            cursor: "pointer",
          }}
        >
          Créer une entreprise
        </button>
      </div>
    );
  }

  const currentEntreprise = entreprises.find(e => e.id === currentEntrepriseId);

  return (
    <>
      <Sidebar
        currentEntrepriseId={currentEntrepriseId}
        entreprises={entreprises}
        onSelectEntreprise={handleSelectEntreprise}
        onCreateEntreprise={navigateToCreateEntreprise}
        onNavigateToSettings={navigateToSettings}
        onNavigateToImport={navigateToImport}
      />

      <div style={{ paddingLeft: "1rem" }}>
        {route.page === "home" && currentEntrepriseId && (
          <HomePage
            entrepriseId={currentEntrepriseId}
            entrepriseNom={currentEntreprise?.nom || ""}
            onNavigateToFactures={navigateToFactures}
            onNavigateToImport={navigateToImport}
            onReloadEntreprises={loadEntreprises}
          />
        )}

        {route.page === "factures" && currentEntrepriseId && (
          <EntreprisePage
            entrepriseId={currentEntrepriseId}
            onBack={navigateToHome}
          />
        )}

        {route.page === "import" && currentEntrepriseId && (
          <ImportPage
            entrepriseId={currentEntrepriseId}
            onBack={navigateToHome}
          />
        )}

        {route.page === "settings" && (
          <div style={{ padding: "2rem" }}>
            <h1>Paramètres</h1>
            <p>Page de configuration des formats CSV (à venir)</p>
            <button onClick={navigateToHome}>Retour</button>
          </div>
        )}

        {route.page === "create-entreprise" && (
          <CreateEntreprisePage
            onBack={navigateToHome}
            onCreated={loadEntreprises}
          />
        )}
      </div>
    </>
  );
}
