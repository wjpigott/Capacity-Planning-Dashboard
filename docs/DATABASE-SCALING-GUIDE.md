# Database Scaling Quick Reference

## Current Database Status
```
Server:   <sql-server-name>.database.windows.net
Database: <sql-database-name>
Tier:     Standard S0 (10 DTUs)
Size:     256 GB
Cost:     ~$25/month
```

## One-Command Scaling Commands

### Scale to S1 (Recommended first upgrade)
```bash
az sql db update \
  --resource-group <resource-group-name> \
  --server <sql-server-name> \
  --name <sql-database-name> \
  --edition Standard \
  --service-objective S1
```
- **Impact**: Completes in ~5 minutes, briefly pauses connections
- **Cost**: ~$50/month (+$25/mo)
- **DTUs**: 20 (2x current)

### Scale to S2
```bash
az sql db update \
  --resource-group <resource-group-name> \
  --server <sql-server-name> \
  --name <sql-database-name> \
  --edition Standard \
  --service-objective S2
```
- **DTUs**: 50 (5x current)
- **Cost**: ~$100/month

### Scale to S3
```bash
az sql db update \
  --resource-group <resource-group-name> \
  --server <sql-server-name> \
  --name <sql-database-name> \
  --edition Standard \
  --service-objective S3
```
- **DTUs**: 100 (10x current)  
- **Cost**: ~$150/month
- **Note**: S4+ are being phased out; consider vCore if S3 isn't enough

## DTO Model Cost Savings

| Approach | Cost/Month | Performance | Timeline |
|---|---|---|---|
| S0 + DTO Optimization | $25 | 70% faster | Today |
| S0 → S1 (without DTO) | $50 | +100% capacity | 5 min |
| **S0 + DTO + S1** | $50 | 70% DTO + vCore headroom | 1 hour |

**Recommendation**: Implement DTOs first before scaling. You'll likely get 70% improvement for $0 extra cost.

## Scaling Timeline

1. **Week 1**: Deploy DTO optimization (no cost change)
   - Apply indexes
   - Deploy code with `/api/capacity/paged` endpoint
   - Monitor dashboard latency

2. **Week 2-3**: Validate improvements
   - Check Application Insights metrics
   - Confirm users report faster loads
   - If still slow: proceed to Step 3

3. **If Needed**: Scale to S1
   - Run scaling command above
   - 5-minute operation
   - Monitor metrics for 24 hours

## Monitoring During Scaling

While updating database tier, watch these metrics:

```bash
# Check scaling progress
az sql db show \
  --resource-group <resource-group-name> \
  --server <sql-server-name> \
  --name <sql-database-name> \
  --query "{status: status, sku: sku, Edition: currentServiceObjectiveName}"
```

Expected output shows update progress, then completed tier.

## Cost Comparison: STU Model vs vCore

### Standard Tier (DTU) - Recommended for Now
| Tier | DTUs | Cost/Month | When to Use |
|---|---|---|---|
| S0 | 10 | $25 | Dev, light testing |
| S1 | 20 | $50 | Small prod, <5K concurrent queries/day |
| S2 | 50 | $100 | Small prod, 5-20K concurrent |
| S3 | 100 | $150 | Medium prod (max before vCore) |

### vCore Model - Future Migration
| vCores | Compute | Cost/Month | When to Use |
|---|---|---|---|
| 2 | General Purpose | $100 | Replace S3 |
| 4 | General Purpose | $200 | Replace S3+ |
| 8 | General Purpose | $400 | High-scale prod |

**Decision Rule**:
- S0-S3 costs less than vCore up to ~2-3 vCores equivalent
- Only migrate to vCore when exceeding S3 AND needing Business Critical redundancy

## Maintenance During Scaling

The scaling operation:
- Takes 5-10 minutes
- **Will temporarily drop active connections** (~10-30 seconds)
- Automatically retries operations
- No manual intervention needed

**Best Practice**: Run scaling during off-hours or maintenance window.

## Reverting (If Needed)

Scale back down to S0 with same command:
```bash
az sql db update \
  --resource-group <resource-group-name> \
  --server <sql-server-name> \
  --name <sql-database-name> \
  --edition Standard \
  --service-objective S0
```

**Cost**: Returns to $25/month

---

## Performance Targets After Optimization

With DTO + Pagination + Indexes on S0:
- Grid page load: **1-2 seconds** (vs 3-8 sec baseline)
- API response: **100-300ms** (vs 500-800ms baseline)
- Payload size: **0.5-1 MB** (vs 2-5 MB baseline)
- Supports **500+ concurrent users**

Scaling to S1 adds:
- **2x concurrent query headroom**
- **3-5x more result set capacity**
- **Auto-scaling for traffic spikes**

---

**Q: Should I scale immediately?**
A: No - implement DTO optimization first. You'll get ~70% improvement for free. Scale only if still slow after 1-2 weeks.

**Q: What's the projected cost after optimization?**
A: S0 + DTO cost: $25/month. If you scale to S1: $50/month. Both still far cheaper than vCore.

**Q: Will DTOs require code changes in my app?**
A: Yes, but minimal. Use `/api/capacity/paged` endpoint instead of `/api/capacity`. The response format is the same, just paginated and smaller.
