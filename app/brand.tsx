export default function Brand({ href }: { href?: string }) {
  const content = (
    <>
      <span className="brandmark" aria-hidden="true">
        A<span>•</span>
      </span>
      <b>ApnaDesign</b>
      <span className="beta">BETA</span>
    </>
  );
  return href ? (
    <a
      className="brand brand-home"
      href={href}
      aria-label="ApnaDesign home"
      title="Back to projects"
    >
      {content}
    </a>
  ) : (
    <div className="brand" aria-label="ApnaDesign">
      {content}
    </div>
  );
}
