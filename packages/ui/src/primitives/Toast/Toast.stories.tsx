import { useEffect } from "react";
import { Button } from "../Button";
import { ToastProvider, useToast } from "./Toast";

export default { title: "Primitives/Toast" };

function Demo({
  type,
  autoShow = false,
}: {
  type?: string;
  autoShow?: boolean;
}) {
  const toast = useToast();
  const show = () =>
    toast.add({
      title: "Sample notification",
      description: "Demo message, no real activity.",
      type,
      timeout: 0,
    });
  useEffect(() => {
    if (autoShow) show();
    // Run once on mount: the story wants exactly one toast visible.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- show is recreated each render by design
  }, []);
  return (
    <Button variant="secondary" onClick={show}>
      Show {type ?? "neutral"} toast
    </Button>
  );
}
export const Default = () => (
  <ToastProvider>
    <Demo />
  </ToastProvider>
);
export const Visible = () => (
  <ToastProvider>
    <Demo autoShow />
  </ToastProvider>
);
export const ErrorTone = () => (
  <ToastProvider>
    <Demo type="error" autoShow />
  </ToastProvider>
);
export const SuccessTone = () => (
  <ToastProvider>
    <Demo type="success" autoShow />
  </ToastProvider>
);
