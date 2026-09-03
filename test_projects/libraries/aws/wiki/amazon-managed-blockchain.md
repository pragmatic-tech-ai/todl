# Amazon Managed Blockchain

## Purpose

Managed Hyperledger Fabric and Ethereum networks. Eliminates the network-creation overhead and scales to thousands of applications running millions of transactions.

## Trade-offs

- Service has narrowed focus. AWS scaled back the Managed
  Blockchain offering — Hyperledger Fabric was simplified or
  deprecated, while Ethereum node hosting remains. Verify
  current support for the specific protocol before committing.
- "Use blockchain" is itself a strategic question that usually
  has the wrong answer. Most use cases pitched as blockchain
  problems are better solved with a permissioned database
  plus audit logging. Managed Blockchain doesn't change that
  analysis.
- vs. Hyperledger on EC2 / Chainstack / Infura / Alchemy:
  specialised blockchain-infra providers lead on developer
  experience and node feature breadth. Managed Blockchain
  wins when AWS-native IAM is a hard requirement.
