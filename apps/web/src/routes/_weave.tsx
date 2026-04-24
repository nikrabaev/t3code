import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";

function WeaveRouteLayout() {
  return <Outlet />;
}

export const Route = createFileRoute("/_weave")({
  beforeLoad: async ({ context }) => {
    if (context.authGateState.status !== "authenticated") {
      throw redirect({ to: "/pair", replace: true });
    }
  },
  component: WeaveRouteLayout,
});
