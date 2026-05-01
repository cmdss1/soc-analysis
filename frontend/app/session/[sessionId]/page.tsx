import SessionWorkspace from "./SessionWorkspace";

export default function SessionPage({
  params,
}: {
  params: { sessionId: string };
}) {
  return <SessionWorkspace sessionId={params.sessionId} />;
}
