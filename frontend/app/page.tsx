"use client";

import dynamic from "next/dynamic";

// Render the entire dApp client-side only. RainbowKit/wagmi rely on browser
// globals (indexedDB, etc.) and must not run during Next's static prerender.
const App = dynamic(() => import("./App"), { ssr: false });

export default function Home() {
  return <App />;
}
