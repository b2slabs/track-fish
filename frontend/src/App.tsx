import { HashRouter, Route, Routes } from 'react-router-dom';
import { BrowsePage } from '@/pages/BrowsePage';
import { FishDetailPage } from '@/pages/FishDetailPage';

// HashRouter: GitHub Pages serves this as a static site with no server-side
// rewrite rules, so a browser-history router would 404 on a direct load of
// (or refresh on) /fish/:id. Hash routes always resolve to index.html.
function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<BrowsePage />} />
        <Route path="/fish/:canonicalFishId" element={<FishDetailPage />} />
      </Routes>
    </HashRouter>
  );
}

export default App;
