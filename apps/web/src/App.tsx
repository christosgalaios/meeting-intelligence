import { Link, Route, Routes } from 'react-router-dom';
import { AppProvider } from './AppContext';
import { Shell } from './components/Shell';
import { AskPage } from './pages/AskPage';
import { LibraryPage } from './pages/LibraryPage';
import { MeetingPage } from './pages/MeetingPage';

function NotFound() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-10 text-center">
      <h1 className="m-0 text-[17px] font-semibold">Page not found</h1>
      <Link to="/">Back to the library</Link>
    </div>
  );
}

export function App() {
  return (
    <AppProvider>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<LibraryPage />} />
          <Route path="ask" element={<AskPage />} />
          <Route path="meetings/:id" element={<MeetingPage />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </AppProvider>
  );
}
