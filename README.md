# SecuPipeline Desktop

Electron 기반 자체 보안 CI/CD 데스크탑 앱입니다.

## 기술 스택

- Electron
- React 19
- TypeScript
- Tailwind CSS v4
- dayjs
- chart.js + react-chartjs-2
- shadcn UI 스타일 컴포넌트

## 주요 페이지

- 홈 페이지: 슬로건, CTA, 터미널 목업, 수치 카드, 기능 설명 섹션
- GitHub 인증 페이지: 중앙 카드형 로그인, OAuth 이동 버튼, 권한 안내
- 대시보드: 레포지토리 탭, 파이프라인 결과 탭, 검색, 토글, 실행 카드, 점수 차트
- 문서 페이지: 시작 가이드/보안 규칙/운영 문서 요약

## 실행 방법

1. 의존성 설치

   npm install

2. 개발 실행 (Vite + Electron)

   npm run dev

3. 린트 검사

   npm run lint

4. 프로덕션 빌드

   npm run build

5. 빌드 후 Electron 실행

   npm run start

## Electron 보안 설정

- contextIsolation: true
- sandbox: true
- nodeIntegration: false
- allowRunningInsecureContent: false
- window.open / 외부 내비게이션은 https 링크만 외부 브라우저로 허용

## 참고

- GitHub OAuth는 client_id 설정이 필요합니다.
- 현재 인증 버튼 URL에는 client_id 플레이스홀더가 포함되어 있습니다.
