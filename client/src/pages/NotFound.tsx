import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Home } from "lucide-react";
import { useLocation } from "wouter";

export default function NotFound() {
  const [, setLocation] = useLocation();

  const handleGoHome = () => {
    setLocation("/");
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-white">
      <Card className="w-full max-w-lg mx-4 border-0 bg-white shadow-lg">
        <CardContent className="pt-10 pb-10 px-6 text-center">
          <div className="mb-6 flex justify-center">
            <div
              className="rounded-full bg-red-100 p-1 shadow-sm ring-2 ring-red-200"
              aria-hidden
            >
              <div className="flex h-14 w-14 items-center justify-center rounded-full border-[3px] border-red-500 bg-red-400">
                <span className="text-2xl font-bold leading-none text-white">
                  !
                </span>
              </div>
            </div>
          </div>

          <h1 className="mb-2 text-4xl font-bold text-[#111827]">404</h1>

          <h2 className="mb-4 text-xl font-semibold text-[#111827]">
            Page Not Found
          </h2>

          <p className="mb-8 leading-relaxed text-[#6B7280]">
            Sorry, the page you are looking for doesn&apos;t exist.
            <br />
            It may have been moved or deleted.
          </p>

          <div
            id="not-found-button-group"
            className="flex justify-center"
          >
            <Button
              onClick={handleGoHome}
              className="h-11 w-full max-w-sm rounded-lg bg-[#2563EB] px-6 text-white shadow-md transition-all hover:bg-blue-700 hover:shadow-lg"
            >
              <Home className="mr-2 h-4 w-4" />
              Go Home
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
