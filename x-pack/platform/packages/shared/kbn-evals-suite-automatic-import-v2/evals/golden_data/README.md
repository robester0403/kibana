# Golden Data

This folder holds raw log samples copied from real Elastic integrations.
Files here are **gitignored** — they stay local to your machine.

## Folder structure

```
golden_data/
├── syslog_firewall/
│   └── samples.log          # one raw log line per line
├── json_auth/
│   └── samples.log
├── key_value/
│   └── samples.log
├── csv_webserver/
│   └── samples.log
├── syslog_vpn/
│   └── samples.log
└── <your_custom_dataset>/
    └── samples.log
```

## How to add a new dataset

1. Create a subfolder here named after your dataset (e.g. `palo_alto_firewall/`)
2. Drop a `samples.log` file with one raw log line per line
3. Create a matching dataset `.ts` file in `evals/datasets/`
4. Add it to `all_datasets.ts`

The dataset loader reads from `samples.log` at runtime.
If the file is missing, the inline fallback samples in the `.ts` file are used instead.
