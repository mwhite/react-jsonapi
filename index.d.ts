import React from 'react';
import Backbone from 'backbone';

interface RelationShapeOptions {
    key: string,
    fields?: [string],
    relations?: [RelationShapeOptions],
    fragments?: [RelationShapeOptions]
}

interface QueryShapeOptions extends RelationShapeOptions {
    key: never;
}

interface CacheOptions {
    loadFromCache?: boolean,
    alwaysFetch?: boolean,
    updateCache?: boolean
}

interface QueryOptions extends QueryShapeOptions, CacheOptions {}

interface ModelQueryDefinition extends QueryOptions {
    model: Backbone.Model,
    id: number | string
}

interface CollectionQueryDefinition extends QueryOptions {
    model: Backbone.Collection
    filter?: string | { [key: string]: string },
    sort?: string,
    page?: string | { [key: string]: string}    
}

type QueryDefinition = 
    ModelQueryDefinition | CollectionQueryDefinition;

interface Variables {
    [key: string]: any
}

type RouteQueryDefinitionFunction = (
    params: { [key: string]: any },
    location: any,
    vars: Variables
) => QueryDefinition;

type StandaloneQueryDefinitionFunction = (
    props: { [key: string]: any },
    vars: Variables
) => QueryDefinition;

interface QueriesOptions extends CacheOptions {
    initialVars?: Variables,
    getInitialVars?(): Variables,
    queries: {
        [key: string]: RouteQueryDefinitionFunction |
            StandaloneQueryDefinitionFunction
    }
}

interface FragmentsOptions {
    fragments: {
        [key: string]: QueryShapeOptions
    }
}

interface Queries {
    vars: Variables,
    pendingVars: Variables,
    setVars(vars: Variables): void,
    fetching: boolean,
    hasErrors: boolean,
    [key: string]: Backbone.Model | Backbone.Collection
}

interface APIComponent extends React.Component {
    props: {
        queries: Queries,
        [key: string]: any
    },
    [key: string]: any
}

export default function withJsonApi(
    options: QueriesOptions | FragmentsOptions, 
    Component: React.Component<{}, {}> | React.FunctionComponent
): APIComponent;

export type AsyncProps = React.Component<{}, {}>;