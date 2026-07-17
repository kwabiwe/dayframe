export function PageHeader({
  title,
  description,
  action
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="fill-page-header flex flex-col gap-4 px-5 py-5 md:flex-row md:items-end md:justify-between md:px-8">
      <div>
        <h1 className="text-3xl font-semibold leading-tight text-[var(--foreground)]">
          {title}
        </h1>
        {description ? (
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)]">{description}</p>
        ) : null}
      </div>
      {action}
    </header>
  );
}
