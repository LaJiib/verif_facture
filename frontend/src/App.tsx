import { useState } from "react";
import HomePage from "./pages/NewHomePage";
import EntreprisePage from "./pages/NewEntreprisePage";
import ImportPage from "./pages/NewImportPage";

type Route =
  | { page: "home" }
  | { page: "entreprise"; entrepriseId: number }
  | { page: "import" };

export default function App() {
  const [route, setRoute] = useState<Route>({ page: "home" });

  function navigateToHome() {
    setRoute({ page: "home" });
  }

  function navigateToEntreprise(entrepriseId: number) {
    setRoute({ page: "entreprise", entrepriseId });
  }

  function navigateToImport() {
    setRoute({ page: "import" });
  }

  switch (route.page) {
    case "home":
      return (
        <HomePage
          onSelectEntreprise={navigateToEntreprise}
          onNavigateToImport={navigateToImport}
        />
      );
    case "entreprise":
      return (
        <EntreprisePage
          entrepriseId={route.entrepriseId}
          onBack={navigateToHome}
        />
      );
    case "import":
      return <ImportPage onBack={navigateToHome} />;
    default:
      return null;
  }
}
