import { redirect } from "next/navigation";

export default function EntriesPage() {
  redirect("/timeline?view=list");
}
