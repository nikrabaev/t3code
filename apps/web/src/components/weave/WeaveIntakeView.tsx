import { Spinner } from "../ui/spinner";

export function WeaveIntakeView() {
  return (
    <div className="flex flex-col items-center justify-center p-16 gap-4">
      <Spinner className="h-8 w-8" />
      <div className="text-lg font-medium">Compiling plan…</div>
      <div className="text-sm text-muted-foreground">
        The planner is drafting your Blueprint. This usually takes 10–30 seconds.
      </div>
    </div>
  );
}
