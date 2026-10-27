import { t, useDocumentLanguage } from "./i18n";
import { lazy, Suspense } from "react";
import { useApi } from "./api/useApi";
import { BoothApp } from "./booth/BoothApp";
import { boothApi } from "./booth/api";
import { Button, Container, Text } from "./components/ui";

const StudyApp = lazy(() =>
  import("./StudyApp").then((module) => ({ default: module.StudyApp })),
);
export function App() {
  useDocumentLanguage();
  const config = useApi(() => boothApi.config(), []);
  if (config.error)
    return (
      <Container padTop>
        <Text role="alert">{t(config.error.message)}</Text>
        <Button onClick={config.refetch}>{t("다시 연결하기")}</Button>
      </Container>
    );
  if (!config.data)
    return (
      <Container padTop>
        <Text>{t("거래소를 불러오고 있습니다.")}</Text>
      </Container>
    );
  return config.data.mode === "booth" ? (
    <BoothApp config={config.data} />
  ) : (
    <Suspense fallback={<p>{t("불러오는 중...")}</p>}>
      <StudyApp />
    </Suspense>
  );
}
