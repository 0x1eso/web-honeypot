import Deck from "./Deck.jsx";
import { SLIDES_A } from "./slidesA.jsx";
import { SLIDES_B } from "./slidesB.jsx";

/** 12장 = 도입/공통(1~6) + api 심화/dashboard/마무리(7~12). */
export default function App() {
  return <Deck slides={[...SLIDES_A, ...SLIDES_B]} />;
}
