/**
 * Data Transfer Objects (DTOs) for API responses
 * Optimized to return only necessary fields for each use case
 * Reduces payload size, network bandwidth, and database load
 */

/**
 * Capacity list DTO - minimal fields for grid display
 * ~65% smaller than full capacity record
 */
class CapacityListDTO {
  constructor(row) {
    this.sourceType = row.sourceType || null;
    this.provider = row.provider || null;
    this.region = row.region;
    this.sku = row.sku;
    this.family = row.family;
    this.availability = row.availability;
    this.quotaAvailable = Number(row.quotaLimit || 0) - Number(row.quotaCurrent || 0);
    this.quotaLimit = Number(row.quotaLimit || 0);
    this.subscriptionKey = row.subscriptionKey || 'legacy-data';
  }
}

/**
 * Capacity detail DTO - full details for drill-down views
 */
class CapacityDetailDTO {
  constructor(row) {
    this.capturedAtUtc = row.capturedAtUtc;
    this.sourceType = row.sourceType || null;
    this.provider = row.provider || null;
    this.region = row.region;
    this.sku = row.sku;
    this.family = row.family;
    this.availability = row.availability;
    this.quotaCurrent = Number(row.quotaCurrent || 0);
    this.quotaLimit = Number(row.quotaLimit || 0);
    this.quotaAvailable = Number(row.quotaLimit || 0) - Number(row.quotaCurrent || 0);
    this.monthlyCost = Number(row.monthlyCost || 0);
    this.vCpu = Number(row.vCpu || 0);
    this.memoryGB = Number(row.memoryGB || 0);
    this.zones = (row.zonesCsv || '').split(',').filter(Boolean);
    this.subscriptionKey = row.subscriptionKey || 'legacy-data';
    this.subscriptionId = row.subscriptionId || 'legacy-data';
    this.subscriptionName = row.subscriptionName || 'Legacy data';
  }
}

/**
 * Subscription summary DTO - for subscription dropdown/list
 */
class SubscriptionSummaryDTO {
  constructor(row) {
    this.subscriptionId = row.subscriptionId || 'legacy-data';
    this.subscriptionName = row.subscriptionName || 'Legacy data';
    this.rowCount = Number(row.rowCount || 0);
  }
}

/**
 * Family summary DTO - for SKU family analysis
 */
class FamilySummaryDTO {
  constructor(row) {
    this.family = row.family;
    this.regions = Number(row.regions || 0);
    this.subscriptions = Number(row.subscriptions || 0);
    this.totalQuotaAvailable = Number(row.totalQuotaAvailable || 0);
    this.averageUtilizationPct = Number(row.averageUtilizationPct || 0);
  }
}

/**
 * Capacity trend DTO - for time-series analysis
 */
class TrendDTO {
  constructor(row) {
    this.capturedAtUtc = row.capturedAtUtc;
    this.region = row.region;
    this.family = row.family;
    this.quotaAvailable = Number(row.quotaAvailable || 0);
    this.quotaLimit = Number(row.quotaLimit || 0);
    this.subscriptionCount = Number(row.subscriptionCount || 0);
  }
}

/**
 * Pagination metadata
 */
class PaginationDTO {
  constructor(total, pageSize, pageNumber) {
    this.total = total;
    this.pageSize = pageSize;
    this.pageNumber = pageNumber;
    this.pageCount = Math.ceil(total / pageSize);
    this.hasNext = pageNumber < this.pageCount;
    this.hasPrev = pageNumber > 1;
  }
}

module.exports = {
  CapacityListDTO,
  CapacityDetailDTO,
  SubscriptionSummaryDTO,
  FamilySummaryDTO,
  TrendDTO,
  PaginationDTO
};
