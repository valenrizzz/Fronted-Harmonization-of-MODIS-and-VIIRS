import { createContext, useContext } from 'react';
import { useFireData } from './useFireData';

const FireDataCtx = createContext(null);

/** Estado único compartido por el mapa y la ruta de calendario/estadísticas. */
export function FireDataProvider({ children }) {
  const fd = useFireData();
  return <FireDataCtx.Provider value={fd}>{children}</FireDataCtx.Provider>;
}

export const useFD = () => useContext(FireDataCtx);
