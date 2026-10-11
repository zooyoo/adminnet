import { FilterLogicEnum } from './filter-logic-enum';
import { FilterOperatorEnum } from './filter-operator-enum';
/**
*
*
* @export
* @interface Filter
*/
export interface Filter {
    /**
     * @type {FilterLogicEnum}
     * @memberof Filter
     */
    logic?: FilterLogicEnum;
    /**
     * @type {Array<Filter>}
     * @memberof Filter
     */
    filters?: Array<Filter> | null;
    /**
     * @type {string}
     * @memberof Filter
     */
    field?: string | null;
    /**
     * @type {FilterOperatorEnum}
     * @memberof Filter
     */
    operator?: FilterOperatorEnum;
    /**
     * @type {any}
     * @memberof Filter
     */
    value?: any | null;
}
