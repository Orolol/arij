"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { UploadZone } from "@/components/documents/UploadZone";
import { DocumentViewer } from "@/components/documents/DocumentViewer";

interface Doc {
  id: string;
  name: string;
  contentMd: string;
  mimeType: string;
  createdAt: string;
}

export default function DocumentsPage() {
  const params = useParams();
  const projectId = params.projectId as string;
  const [documents, setDocuments] = useState<Doc[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<Doc | null>(null);

  async function loadDocs() {
    const res = await fetch(`/api/projects/${projectId}/documents`);
    const data = await res.json();
    setDocuments(data.data || []);
  }

  useEffect(() => {
    loadDocs();
  }, [projectId]);

  function handleUploaded() {
    loadDocs();
  }

  return (
    <div className="p-6">
      <h2 className="text-xl font-bold mb-4">Documents</h2>
      <UploadZone projectId={projectId} onUploaded={handleUploaded} />
      <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-2">
          {documents.length === 0 && (
            <p className="text-muted-foreground text-sm">
              No documents uploaded yet
            </p>
          )}
          {documents.map((doc) => (
            <button
              key={doc.id}
              onClick={() => setSelectedDoc(doc)}
              className={`w-full text-left p-3 rounded-md border transition-colors ${
                selectedDoc?.id === doc.id
                  ? "border-primary bg-accent"
                  : "border-border hover:bg-accent/50"
              }`}
            >
              <div className="font-medium text-sm">{doc.name}</div>
              <div className="text-xs text-muted-foreground">{doc.mimeType}</div>
            </button>
          ))}
        </div>
        {selectedDoc && (
          <div>
            <DocumentViewer markdown={selectedDoc.contentMd} />
          </div>
        )}
      </div>
    </div>
  );
}
