import { notFound } from "next/navigation";
import { requireUser, getAccessibleClientIds } from "@/lib/auth";
import { db } from "@/lib/db";
import { ClientSubNav } from "@/components/clients/sub-nav";
import { AddTaskForm } from "@/components/tasks/add-task-form";
import { KanbanBoard } from "@/components/tasks/kanban-board";

interface PageProps {
  params: { id: string };
}

export default async function ClientTasksPage({ params }: PageProps) {
  const user = await requireUser();
  const accessible = await getAccessibleClientIds(user);
  if (!accessible.includes(params.id)) notFound();

  const client = await db.client.findUnique({
    where: { id: params.id },
    select: { id: true, name: true, industry: true },
  });
  if (!client) notFound();

  const tasks = await db.task.findMany({
    where: { clientId: client.id },
    select: {
      id: true,
      title: true,
      rule: true,
      priority: true,
      status: true,
      source: true,
      createdAt: true,
      client: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className='space-y-8'>
      <div className='space-y-4'>
        <div>
          <h1 className='text-2xl font-semibold tracking-tight'>
            {client.name}
          </h1>
          {client.industry && (
            <p className='mt-1 text-sm text-muted-foreground'>
              {client.industry}
            </p>
          )}
        </div>
        <ClientSubNav clientId={client.id} active='tasks' />
      </div>

      <div className='space-y-1'>
        <h2 className='text-xl font-semibold tracking-tight'>Tasks</h2>
        <p className='text-sm text-muted-foreground'>
          Daily workstream for this client.
        </p>
      </div>

      <AddTaskForm
        clients={[{ id: client.id, name: client.name }]}
        defaultClientId={client.id}
        hideClientPicker
      />

      <KanbanBoard
        tasks={tasks}
        showClient={false}
        emptyDescription='Add the first task for this client.'
      />
    </div>
  );
}
