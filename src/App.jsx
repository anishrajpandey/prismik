import { useState } from 'react';
import PrismikCanvas from './components/PrismikCanvas';
import Landing from './components/Landing';

function App() {
  const [isStarted, setIsStarted] = useState(false);

  return (
    <main className="w-full h-screen bg-[#fdfbf7] flex flex-col items-center justify-center font-sans">
      {!isStarted ? (
        <Landing onStart={() => setIsStarted(true)} />
      ) : (
        <PrismikCanvas />
      )}
    </main>
  );
}

export default App;
