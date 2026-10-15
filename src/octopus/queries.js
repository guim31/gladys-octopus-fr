// -----------------------------------------------------------------------------
// The GraphQL documents sent to the Kraken API of Octopus Energy France.
//
// Adapted from ha-octopus-french by domodom30 (MIT licence, see the README
// credits), which reads the same API for Home Assistant: same fields, trimmed
// to what this integration shows. The France platform is its own Kraken
// instance (api.oefr-kraken.energy), distinct from Octopus UK's API.
// -----------------------------------------------------------------------------

export const ENDPOINT = 'https://api.oefr-kraken.energy/v1/graphql/';

// `input` is { email, password } or { refreshToken }.
export const OBTAIN_TOKEN = `
mutation obtainKrakenToken($input: ObtainJSONWebTokenInput!) {
  obtainKrakenToken(input: $input) {
    token
    refreshToken
    refreshExpiresIn
  }
}`;

export const ACCOUNTS = `
query accounts {
  viewer {
    accounts {
      number
    }
  }
}`;

export const ACCOUNT = `
query account($accountNumber: String!, $activeAt: DateTime!) {
  account(accountNumber: $accountNumber) {
    number
    ledgers {
      balance
      ledgerType
      name
      number
    }
    properties {
      id
      supplyPoints(first: 5) {
        edges {
          node {
            id
            externalIdentifier
            marketName
            meterPoint {
              ... on ElectricityMeterPoint {
                id
                distributorStatus
                meterKind
                subscribedMaxPower
                offPeakLabel
                poweredStatus
                providerCalendar {
                  id
                  temporalClasses {
                    code
                    label
                    description
                  }
                }
              }
              ... on GasMeterPoint {
                id
                gasNature
                poweredStatus
              }
            }
          }
        }
      }
    }
    agreements(activeAt: $activeAt, first: 10) {
      edges {
        node {
          id
          validFrom
          validTo
          isActive
          supplyPoint {
            id
            externalIdentifier
          }
          product {
            code
            displayName
          }
          energySupplyRate {
            standingRate {
              pricePerUnitWithTaxes
              unitType
            }
            rates(first: 20) {
              edges {
                node {
                  __typename
                  pricePerUnitWithTaxes
                  unitType
                  validFrom
                  validTo
                  ... on ElectricitySupplyConsumptionRateType {
                    timeSlots {
                      startAt
                      endAt
                    }
                    temporalClass {
                      code
                      label
                    }
                  }
                  ... on ElectricityConsumptionRateType {
                    temporalClass {
                      code
                      label
                    }
                  }
                  ... on SupplyConsumptionRateType {
                    timeSlots {
                      startAt
                      endAt
                    }
                  }
                }
              }
            }
          }
          nextPaymentForecast {
            amount
            date
          }
        }
      }
    }
  }
}`;

export const MEASUREMENTS = `
query measurements(
  $propertyId: ID!
  $startAt: DateTime!
  $endAt: DateTime!
  $utilityFilters: [UtilityFiltersInput]!
  $first: Int
  $after: String
) {
  property(id: $propertyId) {
    measurements(
      startAt: $startAt
      endAt: $endAt
      first: $first
      after: $after
      utilityFilters: $utilityFilters
    ) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          ... on IntervalMeasurementType {
            value
            startAt
            endAt
            metaData {
              statistics {
                label
                value
                costInclTax {
                  estimatedAmount
                  costCurrency
                }
              }
            }
          }
        }
      }
    }
  }
}`;
