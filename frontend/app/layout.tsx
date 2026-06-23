import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Resume Grader — HackerRank rubric",
  description:
    "Score your resume against HackerRank's open-sourced hiring-agent rubric, with every point traced to a specific line.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans">{children}</body>
    </html>
  );
}
