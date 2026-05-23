import { requireUser, getAccessibleClientIds } from "@/lib/auth";
import { db } from "@/lib/db";
import { AddTaskForm } from "@/components/tasks/add-task-form";
import { KanbanBoard } from "@/components/tasks/kanban-board";

export default async function OpsPage() {
  const user = await requireUser();
  const accessible = await getAccessibleClientIds(user);

  const [clients, tasks] = await Promise.all([
    db.client.findMany({
      where: { id: { in: accessible } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.task.findMany({
      where: { clientId: { in: accessible } },
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
    }),
  ]);

  return (
    <div className='space-y-8'>
      <div className='space-y-1'>
        <h1 className='text-2xl font-semibold tracking-tight'>
          Ops &amp; Tasks
        </h1>
        <p className='text-sm text-muted-foreground'>
          All tasks across your portfolio. Add quick tasks below and triage in
          the kanban.
        </p>
      </div>

      <AddTaskForm clients={clients} />

      <KanbanBoard
        tasks={tasks}
        showClient
        emptyDescription='Add your first task to get going.'
      />
    </div>
  );
}
