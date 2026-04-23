import { redirect } from "next/navigation";

export default function TeacherDocumentsRedirectPage() {
  redirect("/teacher/events");
}
