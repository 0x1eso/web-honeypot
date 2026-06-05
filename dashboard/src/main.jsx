/**
 * 앱 부트스트랩 진입점.
 *
 * index.html 의 <div id="root"> 에 React 트리를 마운트한다.
 * CSS import 순서가 중요한데, tokens.css 가 먼저 들어가야
 * 후속 컴포넌트 스타일에서 --color-*, --space-* 같은 CSS variable 이
 * 정의된 상태로 cascade 된다 (정의 전 참조 시 invalid 처리).
 *
 * StrictMode 는 개발 환경에서 useEffect / 상태 setter 를 의도적으로
 * 두 번 실행해 사이드이펙트와 멱등성 버그를 조기에 노출시킨다.
 * 프로덕션 빌드에서는 영향 없음.
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/tokens.css'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
