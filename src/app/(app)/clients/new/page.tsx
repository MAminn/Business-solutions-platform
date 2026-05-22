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
          Create a client workspace and attach their Meta ad account details.
          You can connect OAuth access from Integrations.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Client details</CardTitle>
          <CardDescription>
            Required fields are marked with an asterisk. KPI targets and Meta ad
            account fields are optional and can be added later.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ClientForm />
        </CardContent>
      </Card>
    </div>
  );
}
