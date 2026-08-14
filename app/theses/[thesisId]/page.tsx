import { AlphaThesisDetailApp } from "../../components/AlphaApp";

export default async function ThesisPage({ params }: { params: Promise<{ thesisId: string }> }) {
  const { thesisId } = await params;
  return <AlphaThesisDetailApp thesisId={thesisId} />;
}
