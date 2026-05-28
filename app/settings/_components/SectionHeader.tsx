type SectionHeaderProps = {
  title: string;
  description?: string;
};

export function SectionHeader({ title, description }: SectionHeaderProps) {
  return (
    <div className="border-[#d9d8cc] border-b pb-3">
      <h2 className="font-semibold text-[#171814] text-xl">{title}</h2>
      {description ? (
        <p className="mt-1 text-[#5d6256] text-sm">{description}</p>
      ) : null}
    </div>
  );
}
