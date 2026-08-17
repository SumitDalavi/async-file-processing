# async-file-processing Architecture

## System Diagram
The following Mermaid.js sequence diagram maps the core workflow and interactions:

```mermaid
sequenceDiagram
    client->>API: Request Upload URL
API->>S3: Generate Presigned URL
API-->>client: URL
client->>S3: PUT file
S3-)Worker: Event trigger
Worker->>DB: Process metadata
```

## Component Breakdown
- **Core Technology**: Node.js, S3
- **Design Paradigm**: Emphasizes high availability, fault tolerance, and security.

## Security & Scaling Considerations
- Strict boundary validations.
- Horizontal scalability achieved via stateless workers.
- Encrypted data at rest and in transit.
