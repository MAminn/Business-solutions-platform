import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ClientForm } from "@/components/clients/client-form";

export default function NewClientPage() {
  return (
    <div className='mx-auto w-full max-w-2xl space-y-6'>
      <div>
        <h1 className='text-2xl font-semibold tracking-tight'>
          Add new client
        </h1>
        <p className='mt-1 text-sm text-muted-foreground'>
          Spin up a new client workspace. You can connect ad accounts after the
          client is created.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Client details</CardTitle>
          <CardDescription>
            Required fields are marked with an asterisk. Budgets and targets can
            be edited later.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ClientForm />
        </CardContent>
      </Card>
    </div>
  );
}
