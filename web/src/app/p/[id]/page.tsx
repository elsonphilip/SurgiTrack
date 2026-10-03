import { redirect } from "next/navigation";

export default async function ProfileIndex({ params }: PageProps<"/p/[id]">) {
  const { id } = await params;
  redirect(`/p/${id}/live`);
}
